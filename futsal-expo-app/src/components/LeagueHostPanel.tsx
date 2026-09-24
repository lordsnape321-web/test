import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  BadgeCheck,
  Banknote,
  Check,
  Coins,
  Crown,
  Eye,
  Send,
  Settings,
  ShieldCheck,
  Trophy,
  UserX,
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
import {
  leaguePaymentsAction,
  leagueTeamsAction,
  searchTeams as searchTeamsApi,
} from "@/api";
import { PaymentLine } from "@/components/LeagueCard";
import { ReceiptViewer } from "@/components/ReceiptUploader";
import { useTheme } from "@/context/ThemeContext";
import {
  TEAM_APPROVED,
  TEAM_INVITED,
  TEAM_REQUESTED,
  clampAmountInput,
  entryStatusLabel,
} from "@/lib/league";
import { formatNPR } from "@/lib/futsal";
import { timeAgo } from "@/lib/time";
import type { LeagueDetail, TeamSearchHit } from "@/lib/types";
import { fontSize, radius, space } from "@/theme";

/**
 * The host's control room 👑 — a 1:1 port of the web app's
 * components/LeagueHostPanel.tsx.
 *
 * Whoever hosts — a player or a venue owner — runs the league from exactly this
 * panel: the entry desk (requests, invitations, the deposit gate), the ledger
 * (who has paid what, cash recorded by hand), and the settings door.
 */
export function LeagueHostPanel({
  league,
  hostId,
  onChanged,
  onEdit,
  onOpenTeam,
}: {
  league: LeagueDetail;
  hostId: number;
  onChanged: () => void;
  onEdit: () => void;
  onOpenTeam?: (teamId: number) => void;
}) {
  const { colors: c, isDark } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteNote, setInviteNote] = useState("");
  const [inviteMatches, setInviteMatches] = useState<TeamSearchHit[]>([]);
  const [recordFor, setRecordFor] = useState<number | null>(null);
  const [viewReceipt, setViewReceipt] = useState("");
  const [cashAmount, setCashAmount] = useState("");

  const entries = league.allTeams;
  const pending = useMemo(
    () => entries.filter((e) => e.status === TEAM_REQUESTED || e.status === TEAM_INVITED),
    [entries],
  );
  const admitted = useMemo(() => entries.filter((e) => e.status === TEAM_APPROVED), [entries]);
  const settled = useMemo(() => admitted.reduce((sum, e) => sum + e.paidAmount, 0), [admitted]);
  const refunded = useMemo(() => entries.reduce((sum, e) => sum + e.refundedAmount, 0), [entries]);
  const full = admitted.length >= league.maxTeams;

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
          ? await leaguePaymentsAction(league.id, { hostId, ...body })
          : await leagueTeamsAction(league.id, { hostId, ...body });
      setMsg(String(data.message ?? "Done ✅"));
      setRecordFor(null);
      setCashAmount("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work 🙏");
    } finally {
      setBusy("");
    }
  }

  async function doSearchTeams() {
    const q = inviteCode.trim();
    if (!q) return;
    try {
      const teams = await searchTeamsApi(q);
      setInviteMatches(
        teams
          .filter((t) => !entries.some((e) => e.teamId === t.id && e.status === TEAM_APPROVED))
          .slice(0, 6),
      );
    } catch {
      setInviteMatches([]);
    }
  }

  const noticeTone = err
    ? { bg: isDark ? "rgba(239,68,68,0.10)" : "#FEF2F2", fg: "#DC2626" }
    : { bg: isDark ? "rgba(5,150,105,0.10)" : "#ECFDF5", fg: "#047857" };

  const stats = [
    { l: "In the till", v: formatNPR(settled), i: Banknote },
    { l: "Refunded out", v: formatNPR(refunded), i: Coins },
    { l: "Prize pool", v: formatNPR(league.prizePool), i: Trophy },
    { l: "Squads", v: `${admitted.length}/${league.maxTeams}`, i: BadgeCheck },
  ];

  return (
    <View style={styles.stack}>
      {/* -------------------------------------------------------- money row */}
      <View style={styles.statGrid}>
        {stats.map((s) => (
          <View key={s.l} style={[styles.statCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={styles.statHead}>
              <s.i size={12} color={c.textFaint} />
              <Text style={[styles.statLabel, { color: c.textFaint }]}>{s.l}</Text>
            </View>
            <Text style={[styles.statValue, { color: c.text }]}>{s.v}</Text>
          </View>
        ))}
      </View>

      {msg || err ? (
        <View style={[styles.notice, { backgroundColor: noticeTone.bg }]}>
          <Text style={[styles.noticeText, { color: noticeTone.fg }]}>{err || msg}</Text>
        </View>
      ) : null}

      {/* ------------------------------------------------------- entry desk */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={styles.cardHead}>
          <View style={styles.titleRow}>
            <Crown size={14} color={isDark ? "#6EE7B7" : "#047857"} />
            <Text style={[styles.title, { color: isDark ? "#6EE7B7" : "#047857" }]}>Entry desk</Text>
            {pending.length > 0 ? (
              <View style={styles.waitingBadge}>
                <Text style={styles.waitingBadgeText}>{pending.length} waiting</Text>
              </View>
            ) : null}
          </View>
          <Pressable
            onPress={onEdit}
            accessibilityRole="button"
            style={[styles.settingsBtn, { borderColor: c.border }]}
          >
            <Settings size={14} color={c.textMuted} />
            <Text style={[styles.settingsText, { color: c.textMuted }]}>League settings</Text>
          </Pressable>
        </View>

        {pending.length === 0 ? (
          <Text style={[styles.muted, { color: c.textFaint }]}>
            No squad is waiting. Requests land here the moment a captain asks, and invitations land
            in their notifications the moment you send one.
          </Text>
        ) : (
          <View style={styles.list}>
            {pending.map((e) => {
              const label = entryStatusLabel(e.status);
              const gate = e.payment.depositMet;
              return (
                <View key={e.teamId} style={[styles.entry, { borderColor: c.border }]}>
                  <View style={styles.entryTop}>
                    <View style={styles.grow}>
                      <Pressable
                        onPress={() =>
                          onOpenTeam ? onOpenTeam(e.teamId) : router.push(`/teams/${e.teamId}`)
                        }
                        accessibilityRole="button"
                      >
                        <Text style={[styles.entryName, { color: c.text }]} numberOfLines={1}>
                          {e.name}{" "}
                          <Text style={[styles.entryCode, { color: c.textFaint }]}>{e.teamCode}</Text>
                        </Text>
                      </Pressable>
                      <Text style={[styles.entryMeta, { color: c.textMuted }]}>
                        {label.emoji} {label.label} • {e.captainName} • {e.memberCount} players •{" "}
                        {e.createdAt ? timeAgo(e.createdAt) : ""}
                      </Text>
                      {e.message ? (
                        <Text style={[styles.entryQuote, { color: c.textMuted }]} numberOfLines={2}>
                          “{e.message}”
                        </Text>
                      ) : null}
                      <PaymentLine
                        entryFee={league.entryFee}
                        paidAmount={e.paidAmount}
                        refundedAmount={e.refundedAmount}
                        depositPercent={league.depositPercent}
                        refundPercent={league.refundPercent}
                        locked={e.payment.locked}
                      />
                      {/* How they're paying, and the proof if they attached any —
                          which is what a host looks at before tapping Approve. */}
                      {e.payMethod || e.receiptUrl ? (
                        <View style={styles.payMeta}>
                          {e.payMethod ? (
                            <View style={[styles.methodChip, { backgroundColor: c.inset }]}>
                              <Text style={[styles.methodChipText, { color: c.textMuted }]}>
                                {e.payMethod === "eSewa" ? "💚" : e.payMethod === "Khalti" ? "💜" : "💵"}{" "}
                                {e.payMethod}
                              </Text>
                            </View>
                          ) : null}
                          {e.receiptUrl ? (
                            <Pressable
                              onPress={() => setViewReceipt(e.receiptUrl)}
                              accessibilityRole="button"
                              style={[styles.receiptBtn, { borderColor: isDark ? "rgba(16,185,129,0.4)" : "#6EE7B7" }]}
                            >
                              <Eye size={12} color={isDark ? "#6EE7B7" : "#047857"} />
                              <Text style={[styles.receiptBtnText, { color: isDark ? "#6EE7B7" : "#047857" }]}>
                                Payment screenshot
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.entryActions}>
                      <Pressable
                        onPress={() => void act(`approve-${e.teamId}`, { action: "approve", teamId: e.teamId })}
                        disabled={busy !== ""}
                        accessibilityRole="button"
                        accessibilityHint={
                          gate ? "Let them in" : `Deposit of ${formatNPR(e.payment.deposit)} hasn't arrived yet`
                        }
                        style={[
                          styles.approveBtn,
                          { backgroundColor: gate ? "#059669" : "#A8A29E" },
                          busy !== "" ? styles.disabled : null,
                        ]}
                      >
                        {busy === `approve-${e.teamId}` ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Check size={14} color="#FFFFFF" />
                        )}
                        <Text style={styles.approveText}>
                          {e.status === TEAM_REQUESTED ? "Approve" : "Accept entry"}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setRecordFor(recordFor === e.teamId ? null : e.teamId)}
                        accessibilityRole="button"
                        style={[styles.outlineBtn, { borderColor: c.border }]}
                      >
                        <Banknote size={14} color={c.textMuted} />
                        <Text style={[styles.outlineText, { color: c.textMuted }]}>Record cash</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void act(`reject-${e.teamId}`, { action: "reject", teamId: e.teamId })}
                        disabled={busy !== ""}
                        accessibilityRole="button"
                        style={[styles.rejectBtn, busy !== "" ? styles.disabled : null]}
                      >
                        <X size={14} color="#EF4444" />
                        <Text style={styles.rejectText}>
                          {e.status === TEAM_INVITED ? "Cancel invite" : "Decline"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>

                  {recordFor === e.teamId ? (
                    <View style={[styles.cashRow, { backgroundColor: c.inset }]}>
                      {/* Capped at what this squad still owes: a host counting
                          cash shouldn't be able to key in more than the entry
                          fee, because the ledger and the refund maths both
                          believe this number. */}
                      <TextInput
                        value={cashAmount}
                        onChangeText={(t) => setCashAmount(clampAmountInput(t, e.payment.due))}
                        placeholder={`Up to ${formatNPR(Math.max(0, e.payment.due))} owed`}
                        placeholderTextColor={c.textFaint}
                        keyboardType="number-pad"
                        style={[styles.cashInput, { borderColor: c.border, color: c.text, backgroundColor: c.surface }]}
                      />
                      <Text style={[styles.cashOwed, { color: c.textFaint }]}>
                        {formatNPR(Math.max(0, e.payment.due))} owed of {formatNPR(league.entryFee)}
                      </Text>
                      <Pressable
                        onPress={() =>
                          void act(
                            `record-${e.teamId}`,
                            {
                              action: "record",
                              teamId: e.teamId,
                              amount: Number(clampAmountInput(cashAmount, e.payment.due)) || e.payment.deposit,
                              method: "Cash at Venue",
                            },
                            "payments",
                          )
                        }
                        disabled={busy !== ""}
                        accessibilityRole="button"
                        style={[styles.recordBtn, busy !== "" ? styles.disabled : null]}
                      >
                        {busy === `record-${e.teamId}` ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : null}
                        <Text style={styles.recordText}>Record it</Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          void act(
                            `record-${e.teamId}`,
                            {
                              action: "record",
                              teamId: e.teamId,
                              amount: e.payment.due || e.payment.deposit,
                              method: "Cash at Venue",
                            },
                            "payments",
                          )
                        }
                        disabled={busy !== ""}
                        accessibilityRole="button"
                        style={[styles.fullBtn, { borderColor: c.border }, busy !== "" ? styles.disabled : null]}
                      >
                        <Text style={[styles.fullText, { color: c.textMuted }]}>
                          Full {formatNPR(e.payment.due || e.payment.deposit)}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        {/* ------------------------------------------------------- invitations */}
        <View style={[styles.inviteBox, { borderColor: isDark ? "rgba(16,185,129,0.3)" : "#6EE7B7" }]}>
          <View style={styles.inviteHead}>
            <Send size={14} color={isDark ? "#6EE7B7" : "#047857"} />
            <Text style={[styles.inviteTitle, { color: isDark ? "#6EE7B7" : "#047857" }]}>
              Invite a squad
            </Text>
          </View>
          <Text style={[styles.inviteSub, { color: c.textMuted }]}>
            Search by the squad's code or name. A private league can only be entered this way —
            and paying the deposit is how the invited captain accepts.
          </Text>
          <View style={styles.inviteRow}>
            <TextInput
              value={inviteCode}
              onChangeText={setInviteCode}
              onSubmitEditing={() => void doSearchTeams()}
              placeholder="CHARGERS-4X7K"
              placeholderTextColor={c.textFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[
                styles.inviteInput,
                { borderColor: c.border, color: c.text, backgroundColor: c.inset },
              ]}
            />
            <Pressable
              onPress={() => void doSearchTeams()}
              accessibilityRole="button"
              style={styles.findBtn}
            >
              <Text style={styles.findText}>Find</Text>
            </Pressable>
          </View>
          {inviteMatches.length > 0 ? (
            <View style={styles.list}>
              {inviteMatches.map((t) => (
                <View key={t.id} style={[styles.inviteHit, { backgroundColor: c.surface }]}>
                  <View style={styles.grow}>
                    <Text style={[styles.inviteHitName, { color: c.text }]}>
                      {t.name} <Text style={[styles.entryCode, { color: c.textFaint }]}>{t.teamCode}</Text>
                    </Text>
                    <Text style={[styles.inviteHitCaptain, { color: c.textFaint }]}>
                      captain {t.captainName}
                    </Text>
                  </View>
                  <TextInput
                    value={inviteNote}
                    onChangeText={setInviteNote}
                    placeholder="Note (optional)"
                    placeholderTextColor={c.textFaint}
                    style={[styles.noteInput, { borderColor: c.border, color: c.text, backgroundColor: c.inset }]}
                  />
                  <Pressable
                    onPress={() =>
                      void act(`invite-${t.id}`, { action: "invite", teamId: t.id, message: inviteNote })
                    }
                    disabled={busy !== "" || full}
                    accessibilityRole="button"
                    style={[styles.inviteBtn, busy !== "" || full ? styles.disabled : null]}
                  >
                    <Text style={styles.inviteBtnText}>{full ? "Full" : "Invite"}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      {/* ------------------------------------------------------- squad ledger */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={styles.titleRow}>
          <ShieldCheck size={14} color={isDark ? "#6EE7B7" : "#047857"} />
          <Text style={[styles.title, { color: isDark ? "#6EE7B7" : "#047857" }]}>
            Squads &amp; payments
          </Text>
        </View>
        <View style={styles.list}>
          {entries.map((e) => {
            const label = entryStatusLabel(e.status);
            return (
              <View key={e.teamId} style={[styles.squadRow, { borderColor: c.border }]}>
                <View style={styles.grow}>
                  <Text style={[styles.squadName, { color: c.text }]} numberOfLines={1}>
                    {e.name}
                    <Text style={[styles.squadStatus, { color: c.textFaint }]}>
                      {"  "}
                      {label.emoji} {label.label}
                    </Text>
                  </Text>
                  <PaymentLine
                    entryFee={league.entryFee}
                    paidAmount={e.paidAmount}
                    refundedAmount={e.refundedAmount}
                    depositPercent={league.depositPercent}
                    refundPercent={league.refundPercent}
                    locked={e.payment.locked}
                  />
                  {e.payment.locked ? (
                    <Text style={[styles.lockedNote, { color: c.textFaint }]}>
                      🔒 They've played — nothing is refundable on the way out.
                    </Text>
                  ) : null}
                </View>
                {e.status === TEAM_APPROVED ? (
                  <Pressable
                    onPress={() =>
                      void act(`withdraw-${e.teamId}`, { action: "withdraw", teamId: e.teamId })
                    }
                    disabled={busy !== ""}
                    accessibilityRole="button"
                    style={[styles.removeBtn, { borderColor: c.border }, busy !== "" ? styles.disabled : null]}
                  >
                    <UserX size={12} color={c.textMuted} />
                    <Text style={[styles.removeText, { color: c.textMuted }]}>
                      {/* A squad that has played can be taken out, but their money
                          stays — the refund died at the first kick-off. */}
                      {e.payment.locked
                        ? "Remove (no refund)"
                        : `Remove & refund ${league.refundPercent}%`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>

      {/* ------------------------------------------------------------- ledger */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={styles.titleRow}>
          <Banknote size={14} color={isDark ? "#6EE7B7" : "#047857"} />
          <Text style={[styles.title, { color: isDark ? "#6EE7B7" : "#047857" }]}>Ledger</Text>
        </View>
        {league.payments.length === 0 ? (
          <Text style={[styles.muted, { color: c.textFaint }]}>
            Nothing has moved yet. Every eSewa/Khalti payment a captain makes lands here, and so
            does every rupee of cash you record.
          </Text>
        ) : (
          <View style={styles.ledger}>
            {league.payments.map((p) => (
              <View key={p.id} style={styles.ledgerRow}>
                <View style={styles.grow}>
                  <Text style={[styles.ledgerTeam, { color: c.text }]} numberOfLines={1}>
                    {p.teamName}{" "}
                    <Text style={[styles.ledgerKind, { color: c.textFaint }]}>
                      {p.kind === "entry" ? "paid in" : p.kind === "refund" ? "refunded" : "prize"}
                    </Text>
                  </Text>
                  <Text style={[styles.ledgerMeta, { color: c.textFaint }]}>
                    {p.method}
                    {p.reference ? ` • ${p.reference}` : ""} • {p.createdAt ? timeAgo(p.createdAt) : ""}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.ledgerAmount,
                    { color: p.kind === "entry" ? "#059669" : "#F97316" },
                  ]}
                >
                  {p.kind === "entry" ? "+" : "−"}
                  {formatNPR(p.amount)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {viewReceipt ? <ReceiptViewer url={viewReceipt} onClose={() => setViewReceipt("")} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space["4"] },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: space["3"] },
  statCard: {
    flexGrow: 1,
    flexBasis: 140,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space["3.5"] ?? 14,
  },
  statHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  statLabel: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  statValue: { fontSize: 18, fontWeight: "900", marginTop: 4 },
  notice: { borderRadius: radius.xl, paddingHorizontal: space["4"], paddingVertical: 12 },
  noticeText: { fontSize: fontSize.sm, fontWeight: "700" },
  card: {
    borderRadius: radius["3xl"],
    borderWidth: 1,
    padding: space["5"],
    gap: space["3"],
  },
  cardHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space["2"],
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: {
    fontSize: fontSize.sm,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  waitingBadge: { backgroundColor: "#EF4444", borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  waitingBadgeText: { fontSize: 10, color: "#FFFFFF" },
  settingsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  settingsText: { fontSize: 11, fontWeight: "900" },
  muted: { fontSize: fontSize.sm, fontWeight: "600", lineHeight: 18 },
  list: { gap: space["2"] },
  entry: { borderRadius: radius.xl, borderWidth: 1, padding: space["3"], gap: space["2"] },
  entryTop: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: space["2"] },
  grow: { flex: 1, minWidth: 140 },
  entryName: { fontSize: fontSize.base, fontWeight: "900" },
  entryCode: { fontSize: 10, fontWeight: "700" },
  entryMeta: { fontSize: 11, fontWeight: "700", marginTop: 2 },
  entryQuote: { fontSize: 11, fontStyle: "italic", marginTop: 4 },
  payMeta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 4 },
  methodChip: { borderRadius: radius.lg, paddingHorizontal: 8, paddingVertical: 2 },
  methodChipText: { fontSize: 11, fontWeight: "900" },
  receiptBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  receiptBtnText: { fontSize: 11, fontWeight: "900" },
  entryActions: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  approveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  approveText: { fontSize: 11, fontWeight: "900", color: "#FFFFFF" },
  outlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  outlineText: { fontSize: 11, fontWeight: "900" },
  rejectBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  rejectText: { fontSize: 11, fontWeight: "900", color: "#EF4444" },
  disabled: { opacity: 0.5 },
  cashRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.lg,
    padding: space["2.5"] ?? 10,
  },
  cashInput: {
    minWidth: 140,
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space["3"],
    paddingVertical: 9,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  cashOwed: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  recordBtn: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    backgroundColor: "#1C1917",
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  recordText: { fontSize: 11, fontWeight: "900", color: "#FFFFFF" },
  fullBtn: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  fullText: { fontSize: 11, fontWeight: "900" },
  inviteBox: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.xl,
    padding: space["3.5"] ?? 14,
    gap: 6,
  },
  inviteHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  inviteTitle: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  inviteSub: { fontSize: 11, fontWeight: "600", lineHeight: 16 },
  inviteRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  inviteInput: {
    flex: 1,
    minWidth: 140,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space["3"],
    paddingVertical: 9,
    fontSize: fontSize.sm,
    fontWeight: "700",
    letterSpacing: 1,
  },
  findBtn: { backgroundColor: "#1C1917", borderRadius: radius.lg, paddingHorizontal: 16, justifyContent: "center" },
  findText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  inviteHit: {
    borderRadius: radius.lg,
    paddingHorizontal: space["3"],
    paddingVertical: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  inviteHitName: { fontSize: fontSize.sm, fontWeight: "700" },
  inviteHitCaptain: { fontSize: 10, fontWeight: "600" },
  noteInput: {
    width: 130,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 10,
    fontWeight: "600",
  },
  inviteBtn: { backgroundColor: "#059669", borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 7 },
  inviteBtnText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  squadRow: {
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: space["3.5"] ?? 14,
    paddingVertical: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  squadName: { fontSize: fontSize.base, fontWeight: "700" },
  squadStatus: { fontSize: 11, fontWeight: "900" },
  lockedNote: { fontSize: 10, fontWeight: "600", marginTop: 2 },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  removeText: { fontSize: 10, fontWeight: "900" },
  ledger: { gap: 0 },
  ledgerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(163,163,163,0.3)",
  },
  ledgerTeam: { fontSize: fontSize.sm, fontWeight: "700" },
  ledgerKind: { fontSize: fontSize.sm, fontWeight: "600" },
  ledgerMeta: { fontSize: 10, fontWeight: "600", marginTop: 2 },
  ledgerAmount: { fontSize: fontSize.base, fontWeight: "900" },
});
