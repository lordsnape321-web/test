import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Check,
  Coins,
  Lock,
  LogOut,
  Send,
  ShieldCheck,
  Trophy,
  Wallet,
  X,
} from "lucide-react-native";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { fetchUserTeams, leaguePaymentsAction, leagueTeamsAction } from "@/api";
import { PaymentLine } from "@/components/LeagueCard";
import { ReceiptUploader, isOnlineMethod } from "@/components/ReceiptUploader";
import { useTheme } from "@/context/ThemeContext";
import { TEAM_APPROVED, TEAM_INVITED, TEAM_REQUESTED, entryStatusLabel } from "@/lib/league";
import { formatNPR } from "@/lib/futsal";
import type { LeagueDetail, UserTeamLite } from "@/lib/types";
import { fontSize, radius, space } from "@/theme";

/** The three media a booking offers — a league entry is the same money. */
const LEAGUE_PAY_METHODS = ["eSewa", "Khalti", "Cash at Venue"];

/**
 * The captain's side of a league 🤝 — a 1:1 port of the web app's
 * components/LeagueSquadPanel.tsx.
 *
 * One panel per squad the viewer belongs to, with the single next action spelled
 * out: ask to join, accept an invitation by paying the deposit, settle what's
 * left, and leave and take the 10% back. The rules the server enforces are the
 * same ones written here — the panel just says them before you press anything.
 *
 * Payment adaptation (same seam as booking/[id]): the web initiates a gateway
 * redirect; native posts `action: "verify"` with `mockApprove: true` directly —
 * the exact body the web's mock-gateway page posts, so it runs the identical
 * server path (ledger row + auto-approve on a met deposit).
 */
export function LeagueSquadPanel({
  league,
  viewerId,
  onChanged,
}: {
  league: LeagueDetail;
  viewerId: number;
  onChanged: () => void;
}) {
  const { colors: c, isDark } = useTheme();
  const router = useRouter();
  const [myTeams, setMyTeams] = useState<UserTeamLite[]>([]);
  const [busy, setBusy] = useState("");
  // Which wallet the captain reaches for, per squad — the same choice a
  // booking asks for, and it sticks while they're on the page.
  const [methodByTeam, setMethodByTeam] = useState<Record<number, string>>({});
  const [receiptByTeam, setReceiptByTeam] = useState<Record<number, string>>({});
  const [receiptOpenFor, setReceiptOpenFor] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!viewerId) return;
    (async () => {
      try {
        setMyTeams(await fetchUserTeams(viewerId));
      } catch {
        setMyTeams([]);
      }
    })();
  }, [viewerId]);

  const entryByTeam = useMemo(() => {
    const map = new Map<number, NonNullable<LeagueDetail["viewer"]>["myTeams"][number]>();
    for (const m of league.viewer?.myTeams ?? []) map.set(m.teamId, m);
    return map;
  }, [league.viewer]);

  if (!viewerId) return null;

  const closed = league.status === "completed" || league.status === "cancelled";
  const full = league.approvedTeams >= league.maxTeams;

  async function act(
    label: string,
    body: Record<string, unknown>,
    kind: "teams" | "payments" = "teams",
  ) {
    setBusy(label);
    setMsg("");
    setErr("");
    try {
      const data =
        kind === "payments"
          ? await leaguePaymentsAction(league.id, body)
          : await leagueTeamsAction(league.id, body);
      setMsg(String(data.message ?? "Done ✅"));
      setNote("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work 🙏");
    } finally {
      setBusy("");
    }
  }

  const methodFor = (teamId: number) => methodByTeam[teamId] ?? "eSewa";
  const receiptFor = (teamId: number) => receiptByTeam[teamId] ?? "";

  /**
   * Pay through the medium the captain picked 💳
   *
   * Cash at venue moves no money here: the host records it when they take it,
   * and the screenshot is what bridges the gap. Online methods go straight to
   * verify+mockApprove (see the note at the top of this file).
   */
  async function pay(teamId: number, amount: number) {
    const method = methodFor(teamId);
    if (!isOnlineMethod(method)) {
      setMsg("Hand the cash to the host at the ground and they'll mark it on your entry 💵");
      setErr("");
      return;
    }
    setBusy(`pay-${teamId}`);
    setMsg("");
    setErr("");
    try {
      const data = await leaguePaymentsAction(league.id, {
        action: "verify",
        mockApprove: true,
        userId: viewerId,
        teamId,
        amount,
        method,
      });
      setMsg(String(data.message ?? "Payment recorded ✅"));
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work 🙏");
    } finally {
      setBusy("");
    }
  }

  /** Save the screenshot on its own, for cash payers and early transfers. */
  async function saveReceipt(teamId: number, dataUrl: string) {
    setReceiptByTeam((m) => ({ ...m, [teamId]: dataUrl }));
    await act(
      `receipt-${teamId}`,
      {
        action: "receipt",
        userId: viewerId,
        teamId,
        receiptUrl: dataUrl,
        payMethod: methodFor(teamId),
      },
      "payments",
    );
  }

  const rows = myTeams
    .map((team) => ({ team, entry: entryByTeam.get(team.id) }))
    .filter(({ team }) => team.role === "captain" || entryByTeam.has(team.id));

  const noticeTone = err
    ? { bg: isDark ? "rgba(239,68,68,0.10)" : "#FEF2F2", fg: "#DC2626" }
    : { bg: isDark ? "rgba(5,150,105,0.10)" : "#ECFDF5", fg: "#047857" };

  if (rows.length === 0) {
    return (
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.noSquads, { color: c.textMuted }]}>
          You need to captain a squad to enter a league.{" "}
          <Text
            onPress={() => router.push("/teams")}
            style={[styles.noSquadsLink, { color: isDark ? "#6EE7B7" : "#047857" }]}
          >
            Start or find a team
          </Text>{" "}
          first.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.titleRow}>
        <Trophy size={14} color={isDark ? "#6EE7B7" : "#047857"} />
        <Text style={[styles.title, { color: isDark ? "#6EE7B7" : "#047857" }]}>
          Your squads in this league
        </Text>
      </View>

      {msg || err ? (
        <View style={[styles.notice, { backgroundColor: noticeTone.bg }]}>
          <Text style={[styles.noticeText, { color: noticeTone.fg }]}>{err || msg}</Text>
        </View>
      ) : null}

      <View style={styles.list}>
        {rows.map(({ team, entry }) => {
          const isCaptain = team.role === "captain" || entry?.isCaptain;
          const label = entry ? entryStatusLabel(entry.status) : null;
          const due = entry ? entry.payment.due : league.entryFee;
          return (
            <View key={team.id} style={[styles.row, { borderColor: c.border }]}>
              <View style={styles.rowTop}>
                <View style={styles.teamHead}>
                  <View style={[styles.teamAvatar, { backgroundColor: team.logoColor }]}>
                    <Text style={styles.teamAvatarText}>{team.name.slice(0, 2).toUpperCase()}</Text>
                  </View>
                  <View style={styles.grow}>
                    <Text style={[styles.teamName, { color: c.text }]}>{team.name}</Text>
                    <Text style={[styles.teamMeta, { color: c.textMuted }]}>
                      {label ? `${label.emoji} ${label.label}` : "Not entered yet"}
                      {isCaptain ? "" : " • you're not the captain"}
                    </Text>
                  </View>
                </View>
                {entry ? (
                  <PaymentLine
                    entryFee={league.entryFee}
                    paidAmount={entry.paidAmount}
                    depositPercent={league.depositPercent}
                    refundPercent={league.refundPercent}
                  />
                ) : null}
              </View>

              {/* ------------------------------------------------ pay your way */}
              {/* A squad joining a league picks a medium exactly like a player
                  booking a pitch does — same three, same wording. */}
              {isCaptain && !closed && league.entryFee > 0 && entry && entry.status !== "withdrawn" ? (
                <View style={[styles.payBox, { borderColor: c.border, backgroundColor: c.inset }]}>
                  <Text style={[styles.payLabel, { color: c.textFaint }]}>
                    Pay your way — {league.entryFee > 0 ? `${formatNPR(league.entryFee)} entry` : ""}
                    {entry.payment.due > 0 ? ` • ${formatNPR(entry.payment.due)} left` : " • settled"}
                  </Text>
                  <View style={styles.methods}>
                    {LEAGUE_PAY_METHODS.map((m) => {
                      const on = methodFor(team.id) === m;
                      return (
                        <Pressable
                          key={m}
                          onPress={() => setMethodByTeam((map) => ({ ...map, [team.id]: m }))}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          style={[
                            styles.method,
                            on
                              ? {
                                  borderColor: "#10B981",
                                  backgroundColor: isDark ? "rgba(16,185,129,0.10)" : "#ECFDF5",
                                }
                              : { borderColor: c.border, backgroundColor: c.surface },
                          ]}
                        >
                          <Wallet
                            size={14}
                            color={on ? (isDark ? "#6EE7B7" : "#047857") : c.textMuted}
                          />
                          <Text
                            style={[
                              styles.methodText,
                              { color: on ? (isDark ? "#6EE7B7" : "#047857") : c.textMuted },
                            ]}
                          >
                            {m}
                            {m === "eSewa" ? " 💚" : m === "Khalti" ? " 💜" : " 💵"}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={[styles.methodHint, { color: c.textFaint }]}>
                    {isOnlineMethod(methodFor(team.id))
                      ? `You'll be taken to the ${methodFor(team.id)} checkout — nothing is charged until you confirm there.`
                      : "Cash goes to the host at the ground. They mark it on your entry, so bring the exact amount."}
                  </Text>
                  {entry.payment.due > 0 ? (
                    <View style={styles.receiptBlock}>
                      <Pressable
                        onPress={() =>
                          setReceiptOpenFor(receiptOpenFor === team.id ? null : team.id)
                        }
                        accessibilityRole="button"
                      >
                        <Text style={[styles.receiptSummary, { color: c.textMuted }]}>
                          {entry.payment.paid > 0 || receiptFor(team.id)
                            ? "Replace the payment screenshot 🧾"
                            : "Already paid? Attach a screenshot instead (optional) 🧾"}
                        </Text>
                      </Pressable>
                      {receiptOpenFor === team.id ? (
                        <View style={{ marginTop: 8 }}>
                          <ReceiptUploader
                            value={receiptFor(team.id)}
                            onChange={(dataUrl) => void saveReceipt(team.id, dataUrl)}
                            compact
                          />
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {isCaptain && !closed ? (
                <View style={styles.actions}>
                  {/* Not entered yet: ask to join (public) or wait for an invite. */}
                  {!entry && league.visibility === "private" ? (
                    <View style={styles.inline}>
                      <Lock size={14} color={isDark ? "#FBBF24" : "#B45309"} />
                      <Text style={[styles.privateText, { color: isDark ? "#FBBF24" : "#B45309" }]}>
                        Private league — the host has to invite this squad.
                      </Text>
                    </View>
                  ) : null}
                  {!entry && league.visibility === "public" ? (
                    <>
                      <TextInput
                        value={note}
                        onChangeText={setNote}
                        placeholder="Note to the host (optional)"
                        placeholderTextColor={c.textFaint}
                        maxLength={200}
                        style={[
                          styles.noteInput,
                          { borderColor: c.border, color: c.text, backgroundColor: c.inset },
                        ]}
                      />
                      <Pressable
                        onPress={() =>
                          void act(`request-${team.id}`, {
                            action: "request",
                            userId: viewerId,
                            teamId: team.id,
                            message: note,
                          })
                        }
                        disabled={busy !== "" || full || league.status === "completed"}
                        accessibilityRole="button"
                        style={[
                          styles.primaryBtn,
                          busy !== "" || full || league.status === "completed"
                            ? styles.disabled
                            : null,
                        ]}
                      >
                        {busy === `request-${team.id}` ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Send size={14} color="#FFFFFF" />
                        )}
                        <Text style={styles.primaryText}>
                          {full ? "League is full" : "Request to join"}
                        </Text>
                      </Pressable>
                    </>
                  ) : null}

                  {/* Invited: paying the deposit *is* accepting. */}
                  {entry?.status === TEAM_INVITED ? (
                    <>
                      <Pressable
                        onPress={() => void pay(team.id, entry.payment.deposit)}
                        disabled={busy !== "" || league.entryFee <= 0}
                        accessibilityRole="button"
                        style={[
                          styles.primaryBtn,
                          busy !== "" || league.entryFee <= 0 ? styles.disabled : null,
                        ]}
                      >
                        {busy === `pay-${team.id}` ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <ShieldCheck size={14} color="#FFFFFF" />
                        )}
                        <Text style={styles.primaryText}>
                          {league.entryFee > 0
                            ? `Accept & pay ${formatNPR(entry.payment.deposit)} deposit`
                            : "Accept the invitation"}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          void act(`answer-${team.id}`, {
                            action: "reject",
                            hostId: viewerId,
                            teamId: team.id,
                          })
                        }
                        disabled={busy !== ""}
                        accessibilityRole="button"
                        style={[styles.secondaryBtn, { borderColor: c.border }, busy !== "" ? styles.disabled : null]}
                      >
                        <X size={14} color={c.textMuted} />
                        <Text style={[styles.secondaryText, { color: c.textMuted }]}>Decline</Text>
                      </Pressable>
                    </>
                  ) : null}

                  {/* Asked, deposit still missing: this is the captain's move. */}
                  {entry?.status === TEAM_REQUESTED && !entry.payment.depositMet && league.entryFee > 0 ? (
                    <Pressable
                      onPress={() => void pay(team.id, entry.payment.deposit)}
                      disabled={busy !== ""}
                      accessibilityRole="button"
                      style={[styles.amberBtn, busy !== "" ? styles.disabled : null]}
                    >
                      <Coins size={14} color="#FFFFFF" />
                      <Text style={styles.primaryText}>
                        Pay {formatNPR(entry.payment.deposit)} deposit to lock the spot
                      </Text>
                    </Pressable>
                  ) : null}

                  {/* In, but not settled: offer the rest (25% chunks or the lot). */}
                  {entry?.status === TEAM_APPROVED && due > 0 ? (
                    <>
                      <Pressable
                        onPress={() => void pay(team.id, due)}
                        disabled={busy !== ""}
                        accessibilityRole="button"
                        style={[styles.primaryBtn, busy !== "" ? styles.disabled : null]}
                      >
                        <Coins size={14} color="#FFFFFF" />
                        <Text style={styles.primaryText}>Pay the rest {formatNPR(due)}</Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          void pay(team.id, Math.min(due, Math.max(entry.payment.deposit, 500)))
                        }
                        disabled={busy !== ""}
                        accessibilityRole="button"
                        style={[styles.secondaryBtn, { borderColor: c.border }, busy !== "" ? styles.disabled : null]}
                      >
                        <Text style={[styles.secondaryText, { color: c.textMuted }]}>
                          Pay {formatNPR(Math.min(due, Math.max(entry.payment.deposit, 500)))}
                        </Text>
                      </Pressable>
                    </>
                  ) : null}

                  {entry && entry.status !== "withdrawn" && entry.payment.locked ? (
                    <View style={[styles.lockedBtn, { backgroundColor: c.inset }]}>
                      <Lock size={14} color={c.textMuted} />
                      <Text style={[styles.lockedText, { color: c.textMuted }]}>
                        Entry locked — you've played
                      </Text>
                    </View>
                  ) : null}
                  {entry && entry.status !== "withdrawn" && !entry.payment.locked ? (
                    <Pressable
                      onPress={() =>
                        void act(`withdraw-${team.id}`, {
                          action: "withdraw",
                          userId: viewerId,
                          teamId: team.id,
                        })
                      }
                      disabled={busy !== ""}
                      accessibilityRole="button"
                      style={[styles.withdrawBtn, busy !== "" ? styles.disabled : null]}
                    >
                      <LogOut size={14} color="#EF4444" />
                      <Text style={styles.withdrawText}>
                        {entry.payment.paid > 0
                          ? `Withdraw (${formatNPR(entry.payment.refundable)} back)`
                          : "Withdraw"}
                      </Text>
                    </Pressable>
                  ) : null}
                  {entry?.status === TEAM_APPROVED && due <= 0 ? (
                    <View style={[styles.settledBtn, { backgroundColor: isDark ? "rgba(16,185,129,0.10)" : "#ECFDF5" }]}>
                      <Check size={14} color={isDark ? "#6EE7B7" : "#047857"} />
                      <Text style={[styles.settledText, { color: isDark ? "#6EE7B7" : "#047857" }]}>
                        Entry settled — see you on match day
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {entry && entry.payment.locked && entry.payment.paid > 0 ? (
                <View style={[styles.refundBox, { backgroundColor: c.inset }]}>
                  <Lock size={12} color={c.textMuted} style={{ marginTop: 2 }} />
                  <Text style={[styles.refundText, { color: c.textMuted, flex: 1 }]}>
                    {entry.payment.lockReason} The {league.refundPercent}% refund closed when your
                    first match kicked off — the host has a pitch booked and a fixture list built
                    around you.
                  </Text>
                </View>
              ) : null}
              {entry && !entry.payment.locked && entry.payment.paid > 0 ? (
                <Text style={[styles.refundFine, { color: c.textFaint }]}>
                  Backing out returns {formatNPR(entry.payment.refundable)} ({league.refundPercent}%
                  of what you paid) — the rest stays with the league. That closes once your first
                  match kicks off 🔒
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space["5"],
    gap: space["3"],
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  notice: { borderRadius: radius.xl, paddingHorizontal: space["4"], paddingVertical: 10 },
  noticeText: { fontSize: fontSize.sm, fontWeight: "700" },
  list: { gap: space["3"] },
  row: { borderRadius: radius.xl, borderWidth: 1, padding: space["3.5"] ?? 14, gap: space["2.5"] ?? 10 },
  rowTop: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  teamHead: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0, flex: 1 },
  teamAvatar: {
    width: 36,
    height: 36,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  teamAvatarText: { fontSize: 11, fontWeight: "900", color: "#FFFFFF" },
  grow: { flex: 1, minWidth: 0 },
  teamName: { fontSize: fontSize.base, fontWeight: "900" },
  teamMeta: { fontSize: 11, fontWeight: "700", marginTop: 2 },
  payBox: { borderRadius: radius.xl, borderWidth: 1, padding: space["3"], gap: 8 },
  payLabel: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  methods: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  method: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexGrow: 1,
  },
  methodText: { fontSize: fontSize.sm, fontWeight: "800" },
  methodHint: { fontSize: 11, fontWeight: "600", lineHeight: 16 },
  receiptBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(163,163,163,0.35)",
    paddingTop: 8,
  },
  receiptSummary: { fontSize: 11, fontWeight: "900", textDecorationLine: "underline" },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  inline: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  privateText: { fontSize: 11, fontWeight: "700", flexShrink: 1 },
  noteInput: {
    minWidth: 160,
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space["3"],
    paddingVertical: 10,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#059669",
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 40,
  },
  primaryText: { fontSize: fontSize.sm, fontWeight: "900", color: "#FFFFFF", flexShrink: 1 },
  amberBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F59E0B",
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  secondaryText: { fontSize: fontSize.sm, fontWeight: "900" },
  lockedBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  lockedText: { fontSize: fontSize.sm, fontWeight: "900" },
  withdrawBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  withdrawText: { fontSize: fontSize.sm, fontWeight: "900", color: "#EF4444" },
  settledBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  settledText: { fontSize: fontSize.sm, fontWeight: "900" },
  disabled: { opacity: 0.5 },
  refundBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    borderRadius: radius.lg,
    paddingHorizontal: space["3"],
    paddingVertical: 8,
  },
  refundText: { fontSize: 11, fontWeight: "700", lineHeight: 16 },
  refundFine: { fontSize: 11, fontWeight: "600", lineHeight: 16 },
  noSquads: { fontSize: fontSize.base, fontWeight: "500", lineHeight: 20 },
  noSquadsLink: { fontWeight: "900", textDecorationLine: "underline" },
});
