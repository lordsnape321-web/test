import { useFocusEffect } from "expo-router";
import {
  CalendarCheck,
  Check,
  Gift,
  ReceiptText,
  Shield,
  Swords,
  Ticket,
  Trophy,
  X,
  Lock,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { fetchBookings, fetchVenues, patchBooking } from "@/api";
import { BookingLedgerPanel } from "@/components/BookingLedgerPanel";
import { PlayerRatingBadge } from "@/components/PlayerRating";
import { ReceiptViewer } from "@/components/ReceiptUploader";
import { SettleAmendButton } from "@/components/SettleAmendButton";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { formatNPR, formatTime12, prettyDate } from "@/lib/futsal";
import { SETTLE_EDIT_WINDOW_MS, formatWindowLeft, settleWindow } from "@/lib/booking-ledger";
import { useBreakpoints } from "@/lib/responsive";
import type { Booking } from "@/lib/types";
import { colors, fontSize, radius, space } from "@/theme";

function paymentMethodLabel(method?: string | null) {
  if (method === "Cash at Venue") return "Cash at venue";
  if (method === "Free Play 🎁") return "Free play";
  return method || "Not selected";
}

function paymentStatusLabel(status?: string | null) {
  return String(status || "pending").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const FILTERS = [
  "all",
  "today",
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "rejected",
] as const;

function ScoreWindowBadge({ settledAt }: { settledAt?: string | null }) {
  const { colors: c } = useTheme();
  const [now, setNow] = useState(() => Date.now());
  const win = settleWindow(settledAt, now);

  useEffect(() => {
    if (!win.settled || !win.locksAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [win.settled, win.locksAt]);

  return (
    <Text style={{ color: win.settled && !win.editable ? c.textMuted : "#B45309", fontSize: 10, fontWeight: "800" }}>
      {win.settled ? (win.editable ? `🔒 score window ${formatWindowLeft(win.msLeft)}` : "🔒 score locked") : "score edits open"}
    </Text>
  );
}

/**
 * All bookings across the owner's venues — card rows (RN stand-in for the web
 * table), status filter chips, Collect → BookingLedgerPanel, SettleAmendButton,
 * and the competition score modal.
 */
export default function OwnerBookings() {
  const { user } = useAuth();
  const { colors: c, isDark } = useTheme();
  const { xl } = useBreakpoints();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [venues, setVenues] = useState<Array<{ id: number; ownerId: number | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [viewReceipt, setViewReceipt] = useState<string | null>(null);
  const [scoreFor, setScoreFor] = useState<Booking | null>(null);
  const [homeInput, setHomeInput] = useState("");
  const [awayInput, setAwayInput] = useState("");
  const [savingScore, setSavingScore] = useState(false);
  const [scoreError, setScoreError] = useState("");
  const [scoreNow, setScoreNow] = useState(() => Date.now());
  const [ledgerFor, setLedgerFor] = useState<Booking | null>(null);

  const load = useCallback(async () => {
    const [b, v] = await Promise.all([fetchBookings({ refresh: true }), fetchVenues()]);
    setBookings(b);
    setVenues(v.map((x) => ({ id: x.id, ownerId: x.ownerId ?? null })));
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          await load();
        } finally {
          setLoading(false);
        }
      })();
    }, [load]),
  );

  useEffect(() => {
    if (!scoreFor) return;
    setScoreNow(Date.now());
    const timer = setInterval(() => setScoreNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [scoreFor]);

  const myVenueIds = useMemo(
    () => new Set(venues.filter((v) => user && v.ownerId === user.id).map((v) => v.id)),
    [venues, user],
  );

  const filtered = useMemo(() => {
    const mine = bookings
      .filter((b) => b.venue && myVenueIds.has(b.venue.id))
      .filter(
        (b) =>
          b.visibility !== "competition" ||
          b.competition?.competitionStatus === "accepted" ||
          !b.competition?.competitionStatus ||
          b.competition.competitionStatus === "none",
      );
    if (filter === "all") return mine;
    if (filter === "today") {
      const t = new Date().toISOString().slice(0, 10);
      return mine.filter((b) => b.date === t);
    }
    return mine.filter((b) => b.status === filter);
  }, [bookings, myVenueIds, filter]);

  async function setStatus(id: number, status: string, actor: string = "owner") {
    await patchBooking(id, { status, actor, actorId: user?.id });
    await load();
  }

  function openScore(b: Booking) {
    setScoreNow(Date.now());
    setScoreFor(b);
    setHomeInput(
      b.competition?.homeScore === null || b.competition?.homeScore === undefined
        ? ""
        : String(b.competition.homeScore),
    );
    setAwayInput(
      b.competition?.awayScore === null || b.competition?.awayScore === undefined
        ? ""
        : String(b.competition.awayScore),
    );
    setScoreError("");
  }

  async function saveScore() {
    if (!scoreFor || !user) return;
    const home = homeInput.trim();
    const away = awayInput.trim();
    if ((home === "") !== (away === "")) {
      setScoreError("Both scores or neither — a 1–? result isn't a result ⚽");
      return;
    }
    setSavingScore(true);
    setScoreError("");
    try {
      const response = await patchBooking(scoreFor.id, {
        homeScore: home === "" ? "" : Number(home),
        awayScore: away === "" ? "" : Number(away),
        actorId: user.id,
      });
      const confirmed = response.booking as
        | { homeScore?: number | null; awayScore?: number | null; scoreStatus?: string; scoreUpdatedAt?: string | null }
        | undefined;
      const savedHome = confirmed && "homeScore" in confirmed
        ? confirmed.homeScore ?? null
        : home === "" ? null : Number(home);
      const savedAway = confirmed && "awayScore" in confirmed
        ? confirmed.awayScore ?? null
        : away === "" ? null : Number(away);
      setBookings((current) =>
        current.map((row) =>
          row.id !== scoreFor.id || !row.competition
            ? row
            : {
                ...row,
                competition: {
                  ...row.competition,
                  homeScore: savedHome,
                  awayScore: savedAway,
                  scoreStatus:
                    confirmed?.scoreStatus ?? (savedHome !== null && savedAway !== null ? "recorded" : "awaiting"),
                  scoreUpdatedAt: confirmed?.scoreUpdatedAt ?? new Date().toISOString(),
                },
              },
        ),
      );
      setScoreFor(null);
      await load();
    } catch (e) {
      setScoreError(e instanceof Error ? e.message : "Could not save the score");
    } finally {
      setSavingScore(false);
    }
  }

  const statusColors = (s: string) =>
    s === "pending"
      ? { bg: "rgba(245,158,11,0.15)", fg: "#B45309" }
      : s === "confirmed"
        ? { bg: "rgba(16,185,129,0.15)", fg: "#047857" }
        : s === "completed"
          ? { bg: isDark ? "#1E293B" : "#F1F5F9", fg: c.textMuted }
          : { bg: "rgba(239,68,68,0.15)", fg: "#DC2626" };
  const scoreWindow = scoreFor ? settleWindow(scoreFor.settledAt, scoreNow) : null;
  const scoreLocked = Boolean(scoreWindow?.settled && !scoreWindow.editable);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.titleRow}>
        <CalendarCheck size={22} color={c.text} />
        <Text style={[styles.h1, { color: c.text }]}>All bookings</Text>
      </View>
      <Text style={[styles.sub, { color: c.textMuted }]}>
        Every booking across your venues — collect payments, complete games.
      </Text>
      <View
        style={[
          styles.windowNotice,
          {
            backgroundColor: isDark ? "rgba(245,158,11,0.12)" : "#FFFBEB",
            borderColor: isDark ? "rgba(251,191,36,0.35)" : "#FDE68A",
          },
        ]}
      >
        <Text style={[styles.windowNoticeIcon, { color: isDark ? "#FCD34D" : "#92400E" }]}>⏱️</Text>
        <Text style={[styles.windowNoticeText, { color: isDark ? "#FCD34D" : "#92400E" }]}>
          Settled payments stay editable for {SETTLE_EDIT_WINDOW_MS / 60000} minutes. Every
          payment, correction, and lock is saved through the server ledger.
        </Text>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[
              styles.filterChip,
              filter === f
                ? { backgroundColor: isDark ? "#FFFFFF" : "#0F172A" }
                : { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <Text
              style={[
                styles.filterText,
                filter === f
                  ? { color: isDark ? "#0F172A" : "#FFFFFF" }
                  : { color: c.textMuted },
              ]}
            >
              {f}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={c.textFaint} style={{ marginTop: space[8] }} />
      ) : filtered.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={{ color: c.textMuted, fontSize: fontSize.sm, fontWeight: "700" }}>
            No bookings in this view.
          </Text>
        </View>
      ) : (
        filtered.map((b) => {
          const sc = statusColors(b.status);
          return (
            <View
              key={b.id}
              style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
            >
              <View style={[styles.cardGrid, xl && styles.cardGridWide]}>
                <View style={[styles.colPlayer, !xl && styles.stackColumn]}>
                  <Text style={[styles.mono, { color: c.textFaint }]}>#FN-{b.id}</Text>
                  <View style={styles.nameRow}>
                    <Text style={[styles.bold, { color: c.text }]}>
                      {b.bookerName || b.user?.name}
                    </Text>
                    {b.isFreePlay ? (
                      <View style={[styles.chip, { backgroundColor: "rgba(139,92,246,0.15)" }]}>
                        <Gift size={9} color="#6D28D9" />
                        <Text style={[styles.chipText, { color: "#6D28D9" }]}>FREE</Text>
                      </View>
                    ) : null}
                  </View>
                  {b.teamName ? (
                    <View style={[styles.chip, { backgroundColor: "rgba(14,165,233,0.15)", alignSelf: "flex-start" }]}>
                      <Shield size={9} color="#0369A1" />
                      <Text style={[styles.chipText, { color: "#0369A1" }]}>{b.teamName}</Text>
                    </View>
                  ) : null}
                  {b.competition ? (
                    <View style={styles.chipWrap}>
                      <View style={[styles.chip, { backgroundColor: "rgba(99,102,241,0.15)" }]}>
                        <Swords size={9} color="#4338CA" />
                        <Text style={[styles.chipText, { color: "#4338CA" }]}>
                          vs {b.competition.opponentName || "opponent"}
                        </Text>
                      </View>
                      {b.competition.leagueName ? (
                        <View style={[styles.chip, { backgroundColor: "rgba(245,158,11,0.15)" }]}>
                          <Trophy size={9} color="#B45309" />
                          <Text style={[styles.chipText, { color: "#B45309" }]}>
                            {b.competition.leagueName}
                          </Text>
                        </View>
                      ) : null}
                      <View
                        style={[
                          styles.chip,
                          {
                            backgroundColor:
                              b.competition.scoreStatus === "recorded"
                                ? "rgba(16,185,129,0.15)"
                                : isDark
                                  ? "rgba(100,116,139,0.2)"
                                  : "#F1F5F9",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            {
                              color:
                                b.competition.scoreStatus === "recorded"
                                  ? "#047857"
                                  : c.textMuted,
                            },
                          ]}
                        >
                          {b.competition.scoreStatus === "recorded"
                            ? `⚽ ${b.competition.homeScore}–${b.competition.awayScore}`
                            : "score due"}
                        </Text>
                      </View>
                      <ScoreWindowBadge settledAt={b.settledAt} />
                    </View>
                  ) : null}
                  {b.playerStats ? <PlayerRatingBadge stats={b.playerStats} /> : null}
                  <Text style={[styles.meta, { color: c.textFaint }]}>{b.bookerPhone}</Text>
                </View>

                <View style={[styles.colVenue, !xl && styles.stackColumn]}>
                  <Text style={[styles.bold, { color: c.text }]}>{b.venue?.name}</Text>
                  <Text style={[styles.meta, { color: c.textMuted }]}>{b.court?.name}</Text>
                </View>

                <View style={[styles.colSlot, !xl && styles.stackColumn]}>
                  <Text style={[styles.meta, { color: c.textMuted }]}>{prettyDate(b.date)}</Text>
                  <Text style={[styles.meta, { color: c.textFaint }]}>
                    {formatTime12(b.startTime)} – {formatTime12(b.endTime || b.startTime)}
                  </Text>
                </View>

                <View style={[styles.colAmount, !xl && styles.stackColumn]}>
                  {(b.discountAmount ?? 0) > 0 &&
                  (b.priceBeforeDiscount ?? 0) > b.totalPrice ? (
                    <Text style={[styles.strike, { color: c.textFaint }]}>
                      {formatNPR(b.priceBeforeDiscount ?? 0)}
                    </Text>
                  ) : null}
                  <Text style={[styles.amount, { color: c.text }]}>{formatNPR(b.totalPrice)}</Text>
                  <Text style={[styles.meta, { color: c.textFaint }]}>{paymentMethodLabel(b.paymentMethod)}</Text>
                  {b.promoCode && (b.discountAmount ?? 0) > 0 ? (
                    <View style={[styles.chip, { backgroundColor: "rgba(16,185,129,0.15)" }]}>
                      <Ticket size={9} color="#047857" />
                      <Text style={[styles.chipText, { color: "#047857" }]}>
                        {b.promoCode} −{formatNPR(b.discountAmount ?? 0)}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={[styles.colPay, !xl && styles.stackColumn]}>
                  {b.paymentStatus === "paid" ? (
                    <View style={[styles.chip, { backgroundColor: "rgba(16,185,129,0.15)" }]}>
                      <Text style={[styles.chipText, { color: "#047857" }]}>
                        PAID ✓ {b.gatewayTxnId ? `• ${b.gatewayTxnId.slice(0, 10)}` : ""}
                      </Text>
                    </View>
                  ) : b.paymentStatus === "deposit_paid" ? (
                    <View style={[styles.chip, { backgroundColor: "rgba(245,158,11,0.15)" }]}>
                      <Text style={[styles.chipText, { color: "#B45309" }]}>
                        🛡️ DEPOSIT {formatNPR(b.depositAmount ?? 0)} ✓
                      </Text>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => setLedgerFor(b)}
                      style={[styles.chip, { backgroundColor: "rgba(245,158,11,0.15)" }]}
                      accessibilityLabel="Record payments and extra charges"
                    >
                      <Text style={[styles.chipText, { color: "#B45309" }]}>💰 Collect</Text>
                    </Pressable>
                  )}
                  {b.depositRequired ? (
                    <Text style={[styles.meta, { color: c.textFaint }]}>
                      Deposit {b.depositStatus}
                      {(b.paidAmount ?? 0) > 0 ? ` • ${formatNPR(b.paidAmount)} in` : ""}
                    </Text>
                  ) : null}
                  {b.receiptUrl ? (
                    <Pressable
                      onPress={() => setViewReceipt(b.receiptUrl ?? "")}
                      style={[styles.chip, { backgroundColor: "rgba(14,165,233,0.15)" }]}
                    >
                      <ReceiptText size={9} color="#0369A1" />
                      <Text style={[styles.chipText, { color: "#0369A1" }]}>Receipt</Text>
                    </Pressable>
                  ) : null}
                </View>

                <View style={[styles.colStatus, !xl && styles.stackColumn]}>
                  <View style={[styles.chip, { backgroundColor: sc.bg }]}>
                    <Text style={[styles.chipText, { color: sc.fg, textTransform: "uppercase" }]}>
                      {b.status}
                    </Text>
                  </View>
                </View>

                <View style={[styles.colActions, !xl && styles.stackColumn]}>
                  <SettleAmendButton settledAt={b.settledAt ?? null} onOpen={() => setLedgerFor(b)} />
                  {b.status === "pending" ? (
                    <>
                      <Pressable
                        onPress={() => void setStatus(b.id, "confirmed")}
                        style={[styles.iconAction, { backgroundColor: colors.emerald600 }]}
                        accessibilityLabel="Accept"
                      >
                        <Check size={14} color="#FFFFFF" />
                      </Pressable>
                      <Pressable
                        onPress={() => void setStatus(b.id, "rejected")}
                        style={[
                          styles.iconAction,
                          { backgroundColor: isDark ? "rgba(239,68,68,0.15)" : "#FEE2E2" },
                        ]}
                        accessibilityLabel="Decline"
                      >
                        <X size={14} color="#DC2626" />
                      </Pressable>
                    </>
                  ) : null}
                  {b.competition ? (
                    <Pressable
                      onPress={() => openScore(b)}
                      style={[
                        styles.iconAction,
                        {
                          backgroundColor:
                            b.competition.scoreStatus === "recorded"
                              ? colors.emerald600
                              : "#4F46E5",
                        },
                      ]}
                      accessibilityLabel={
                        b.competition.scoreStatus === "recorded"
                          ? "Fix the recorded score"
                          : "Record the final score"
                      }
                    >
                      <Swords size={14} color="#FFFFFF" />
                    </Pressable>
                  ) : null}
                  {b.status === "confirmed" ? (
                    <Pressable
                      onPress={() => void setStatus(b.id, "completed")}
                      style={[styles.iconAction, { backgroundColor: isDark ? "#FFFFFF" : "#0F172A" }]}
                      accessibilityLabel="Complete"
                    >
                      <Check size={14} color={isDark ? "#0F172A" : "#FFFFFF"} />
                    </Pressable>
                  ) : null}
                  {b.status === "confirmed" || b.status === "pending" ? (
                    <Pressable
                      onPress={() => void setStatus(b.id, "cancelled")}
                      style={[
                        styles.iconAction,
                        { backgroundColor: isDark ? "rgba(239,68,68,0.15)" : "#FEE2E2" },
                      ]}
                      accessibilityLabel="Cancel"
                    >
                      <X size={14} color="#DC2626" />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          );
        })
      )}

      {viewReceipt ? (
        <ReceiptViewer url={viewReceipt} onClose={() => setViewReceipt(null)} />
      ) : null}

      {/* Score desk — competition games only, venue owner only. */}
      <Modal visible={!!scoreFor?.competition} transparent animationType="fade" onRequestClose={() => setScoreFor(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.scoreCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={styles.titleRow}>
              <Swords size={18} color="#6366F1" />
              <Text style={[styles.modalTitle, { color: c.text }]}>Record the final score</Text>
            </View>
            {scoreFor?.competition ? (
              <>
                <Text style={[styles.modalSub, { color: c.textMuted }]}>
                  {scoreFor.teamName || "Home squad"} vs {scoreFor.competition.opponentName || "opponent"} •{" "}
                  {prettyDate(scoreFor.date)} {formatTime12(scoreFor.startTime)}
                  {scoreFor.competition.leagueName
                    ? ` • 🏆 ${scoreFor.competition.leagueName}`
                    : ""}
                </Text>
                <View style={[styles.scoreLockNotice, { backgroundColor: scoreLocked ? c.inset : "rgba(245,158,11,0.12)" }]}>
                  <Lock size={14} color={scoreLocked ? c.textMuted : "#B45309"} />
                  <Text style={[styles.scoreLockText, { color: scoreLocked ? c.textMuted : "#B45309" }]}>                    {scoreWindow?.settled
                      ? scoreLocked
                        ? "Score locked — the 5-minute correction window has closed."
                        : `Score correction window open for ${formatWindowLeft(scoreWindow.msLeft)}.`
                      : "Score edits open — the 5-minute correction window starts when payment is settled."}
                  </Text>
                </View>
                <View style={styles.scoreRow}>
                  <View style={styles.scoreField}>
                    <Text style={[styles.scoreLabel, { color: c.textFaint }]}>
                      🏠 {scoreFor.teamName || "Home"}
                    </Text>
                    <TextInput
                      value={homeInput}
                      onChangeText={(t) => setHomeInput(t.replace(/[^0-9]/g, "").slice(0, 2))}
                      editable={!scoreLocked}
                      keyboardType="numeric"
                      placeholder="—"
                      placeholderTextColor={c.textFaint}
                      style={[styles.scoreInput, { backgroundColor: isDark ? "#0F172A" : "#F8FAFC", color: c.text, borderColor: c.border }]}
                    />
                  </View>
                  <View style={styles.scoreField}>
                    <Text style={[styles.scoreLabel, { color: c.textFaint }]}>
                      🚩 {scoreFor.competition.opponentName || "Away"}
                    </Text>
                    <TextInput
                      value={awayInput}
                      onChangeText={(t) => setAwayInput(t.replace(/[^0-9]/g, "").slice(0, 2))}
                      editable={!scoreLocked}
                      keyboardType="numeric"
                      placeholder="—"
                      placeholderTextColor={c.textFaint}
                      style={[styles.scoreInput, { backgroundColor: isDark ? "#0F172A" : "#F8FAFC", color: c.text, borderColor: c.border }]}
                    />
                  </View>
                </View>
                <View style={[styles.scoreHint, { backgroundColor: "rgba(99,102,241,0.10)" }]}>
                  <Text style={styles.scoreHintText}>
                    Both squads&apos; profiles update the moment you save
                    {scoreFor.competition.leagueName ? ", and the league table follows" : ""}.
                    Wrong score? Reopen this and fix it — clearing both boxes puts it back to
                    &quot;awaiting&quot;.
                  </Text>
                </View>
                {scoreError ? (
                  <View style={[styles.scoreHint, { backgroundColor: "rgba(239,68,68,0.10)" }]}>
                    <Text style={[styles.scoreHintText, { color: "#DC2626" }]}>{scoreError}</Text>
                  </View>
                ) : null}
                <View style={styles.modalActions}>
                  <Pressable
                    onPress={() => setScoreFor(null)}
                    style={[styles.modalBtn, { borderColor: c.border }]}
                  >
                    <Text style={[styles.modalBtnText, { color: c.textMuted }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void saveScore()}
                    disabled={savingScore || scoreLocked}
                    style={[styles.modalBtn, styles.modalBtnPrimary, { opacity: savingScore || scoreLocked ? 0.5 : 1 }]}
                  >
                    <Text style={[styles.modalBtnText, { color: "#FFFFFF" }]}>                      {savingScore ? "Saving…" : scoreLocked ? "Score locked" : "Save result"}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {ledgerFor ? (
        <BookingLedgerPanel
          bookingId={ledgerFor.id}
          bookingLabel={`${prettyDate(ledgerFor.date)} • ${formatTime12(ledgerFor.startTime)} • ${
            ledgerFor.venue?.name ?? "Venue"
          } • ${formatNPR(ledgerFor.totalPrice)}`}
          ownerId={user?.id ?? 0}
          onClose={() => setLedgerFor(null)}
          onSettled={() => {
            void load();
          }}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: space[4], paddingBottom: space[16], gap: space[2] },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  h1: { fontSize: fontSize["2xl"], fontWeight: "900" },
  sub: { fontSize: fontSize.sm },
  windowNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: space[3],
    paddingVertical: space[2.5],
    marginTop: space[2],
  },
  windowNoticeIcon: { fontSize: 14, lineHeight: 16 },
  windowNoticeText: { flex: 1, fontSize: 11, fontWeight: "800", lineHeight: 16 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[3] },
  filterChip: {
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: space[3.5],
    paddingVertical: space[1.5],
    minHeight: 32,
    justifyContent: "center",
  },
  filterText: { fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  emptyCard: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    borderStyle: "dashed",
    padding: space[10],
    alignItems: "center",
    marginTop: space[4],
  },
  card: { borderRadius: radius["2xl"], borderWidth: 1, padding: space[4], marginTop: space[2] },
  cardGrid: { flexDirection: "column", gap: space[4] },
  cardGridWide: { flexDirection: "row", flexWrap: "wrap", gap: space[3], alignItems: "flex-start" },
  stackColumn: {
    width: "100%",
    minWidth: 0,
    flexBasis: "auto",
    flexGrow: 0,
    justifyContent: "flex-start",
  },
  colPlayer: { flexBasis: 140, flexGrow: 1, minWidth: 120, gap: 4 },
  colVenue: { flexBasis: 100, flexGrow: 1, minWidth: 90, gap: 2 },
  colSlot: { flexBasis: 110, minWidth: 100, gap: 2 },
  colAmount: { flexBasis: 90, minWidth: 80, gap: 2 },
  colPay: { flexBasis: 110, minWidth: 100, gap: 4, alignItems: "flex-start" },
  colStatus: { minWidth: 80 },
  colActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1.5],
    alignItems: "center",
    minWidth: 140,
    justifyContent: "flex-end",
  },
  mono: { fontFamily: "monospace", fontSize: fontSize.xs, fontWeight: "700" },
  bold: { fontSize: fontSize.sm, fontWeight: "800" },
  meta: { fontSize: fontSize.xs, fontWeight: "600" },
  nameRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1.5] },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: space[1.5] },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: radius.full,
    paddingHorizontal: space[2],
    paddingVertical: 2,
  },
  chipText: { fontSize: 10, fontWeight: "900" },
  strike: { fontSize: 10, textDecorationLine: "line-through", fontWeight: "700" },
  amount: { fontSize: fontSize.base, fontWeight: "900" },
  iconAction: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: space[4],
  },
  scoreCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: radius["2xl"],
    borderWidth: 1,
    padding: space[6],
    gap: space[3],
  },
  modalTitle: { fontSize: fontSize.lg, fontWeight: "900", flex: 1 },
  modalSub: { fontSize: fontSize.xs, fontWeight: "600", lineHeight: 17 },
  scoreRow: { flexDirection: "row", gap: space[3], marginTop: space[1] },
  scoreField: { flex: 1 },
  scoreLabel: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: space[1.5] },
  scoreInput: {
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: space[3.5],
    paddingVertical: space[3],
    fontSize: fontSize["2xl"],
    fontWeight: "900",
    textAlign: "center",
    minHeight: 56,
  },
  scoreLockNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderRadius: radius.xl,
    paddingHorizontal: space[3],
    paddingVertical: space[2.5],
  },
  scoreLockText: { flex: 1, fontSize: 11, fontWeight: "800", lineHeight: 16 },
  scoreHint: { borderRadius: radius.xl, padding: space[3] },
  scoreHintText: { fontSize: 11, fontWeight: "600", lineHeight: 16, color: "#4338CA" },
  modalActions: { flexDirection: "row", gap: space[2], marginTop: space[1] },
  modalBtn: {
    flex: 1,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: space[3],
    alignItems: "center",
    minHeight: 44,
  },
  modalBtnPrimary: { backgroundColor: "#4F46E5", borderColor: "#4F46E5" },
  modalBtnText: { fontSize: fontSize.sm, fontWeight: "900" },
});
