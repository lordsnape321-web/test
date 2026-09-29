import {
  CheckCheck,
  HandCoins,
  Loader2,
  Plus,
  ReceiptText,
  Users,
  Wallet,
} from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { formatNPR } from "@/lib/futsal";
import type { TeamLedger, TeamLedgerMember } from "@/lib/types";
import { fontSize, radius, space } from "@/theme";
import { fetchTeamLedger, settleTeamShare, teamLedgerAction } from "@/api";
import { Avatar } from "@/components/Avatar";
import { Picker } from "@/components/ThemedPicker";

/**
 * The mediums money actually arrives in. Kept in step with
 * `BookingLedger::LEDGER_METHODS` on the server, which rejects anything else —
 * the picker and the validator have to agree, or the captain picks a method
 * the API refuses.
 */
const METHODS = ["Cash at Venue", "eSewa", "Khalti"] as const;

type Props = {
  bookingId: number;
  /** The signed-in player. The captain of this booking is the only writer. */
  actorId: number;
  /** "4v4 · Kathmandu · Sat 14 Sep", or whatever the host is holding. */
  bookingLabel?: string;
  onClose: () => void;
  /** Fires after every successful write so the booking card can re-read. */
  onChanged?: () => void;
};

/**
 * The captain's ledger for a team booking.
 *
 * A captain fronts the whole cost at the venue and then chases the squad for
 * it, so this is the same idea as the owner's payments panel one level down:
 * record who handed over what, in which medium, and watch the outstanding
 * total fall.
 *
 * Every number and every name on this screen comes from the server —
 * `team_ledger_entries` and `booking_team_payments`, with the people resolved
 * from the users table. Nothing is tallied in a local array and nothing is
 * invented on the device, so what the captain sees here is the record, and a
 * reload or a second phone shows the same thing.
 */
export default function TeamLedgerPanel({
  bookingId,
  actorId,
  bookingLabel,
  onClose,
  onChanged,
}: Props) {
  const { colors: c, isDark } = useTheme();

  const [ledger, setLedger] = useState<TeamLedger | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  // Which squad member the form is open for, and the fields it fills in.
  const [forId, setForId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("Cash at Venue");
  const [note, setNote] = useState("");

  // A member settling their own share, rather than the captain keying it in.
  const [selfTo, setSelfTo] = useState<"captain" | "venue" | null>(null);
  const [selfMethod, setSelfMethod] = useState("Cash at Venue");

  useEffect(() => {
    let dead = false;
    fetchTeamLedger(bookingId, actorId)
      .then((data) => {
        if (!dead) setLedger(data);
      })
      .catch((e) => {
        if (!dead) setError(e instanceof Error ? e.message : "Couldn't load the squad ledger 🙏");
      });
    return () => {
      dead = true;
    };
  }, [bookingId, actorId]);

  function openFor(member: TeamLedgerMember) {
    setForId(member.userId);
    // Seed with what they still owe, so the common case is one tap.
    setAmount(String(member.outstanding));
    setMethod(METHODS[0]);
    setNote("");
    setSelfTo(null);
    setError("");
    setNotice("");
  }

  function closeForm() {
    setForId(null);
    setSelfTo(null);
    setAmount("");
    setNote("");
    setError("");
  }

  async function collect() {
    if (forId == null) return;
    setBusy("collect");
    setError("");
    setNotice("");
    try {
      // An empty box means "whatever they still owe", which the server
      // resolves against the share rather than guessing at zero.
      const res = await teamLedgerAction(bookingId, {
        action: "collect",
        actorId,
        userId: forId,
        method,
        ...(amount.trim() ? { amount: Number(amount.replace(/[^\d]/g, "")) } : {}),
        note: note.trim(),
      });
      if (res.ledger) setLedger(res.ledger);
      setNotice(res.message ?? "Recorded 💰");
      closeForm();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work 🙏");
    } finally {
      setBusy("");
    }
  }

  async function settleSelf() {
    if (selfTo == null) return;
    const member = members.find((m) => m.userId === forId);
    if (!member) return;
    setBusy("settle");
    setError("");
    setNotice("");
    try {
      const res = await settleTeamShare(bookingId, member.userId, {
        actorId,
        paidTo: selfTo,
        method: selfMethod,
      });
      setNotice(res.message ?? "Share settled ✅");
      closeForm();
      // The settle endpoint answers with the updated share, not the whole
      // ledger, so re-read rather than patch a number into it — the member's
      // row changes shape when their share clears, not just its amount.
      fetchTeamLedger(bookingId, actorId)
        .then(setLedger)
        .catch(() => undefined);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work 🙏");
    } finally {
      setBusy("");
    }
  }

  async function voidEntry(entryId: number) {
    setBusy(`void-${entryId}`);
    setError("");
    setNotice("");
    try {
      const res = await teamLedgerAction(bookingId, {
        action: "void",
        actorId,
        entryId,
      });
      if (res.ledger) setLedger(res.ledger);
      setNotice(res.message ?? "Entry undone ↩️");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work 🙏");
    } finally {
      setBusy("");
    }
  }

  const inputCls = [styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }];

  if (!ledger) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.backdrop}>
          <View style={[styles.loadingCard, { backgroundColor: c.surface }]}>
            <ActivityIndicator size="large" color={c.textFaint} />
            {error ? <Text style={[styles.error, { color: c.dangerText }]}>{error}</Text> : null}
            <Pressable onPress={onClose} style={styles.closeGhost} accessibilityRole="button">
              <Text style={[styles.closeGhostText, { color: c.textMuted }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  const { totals, members, isCaptain } = ledger;
  const open = forId != null ? members.find((m) => m.userId === forId) : undefined;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.flex, { backgroundColor: isDark ? "#0F172A" : "#F8FAFC" }]}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* -------------------------------------------------------- header */}
          <View style={styles.headerRow}>
            <View style={styles.grow}>
              <Text style={[styles.title, { color: c.text }]}>
                <Users size={18} color={c.text} /> Squad ledger
              </Text>
              <Text style={[styles.sub, { color: c.textMuted }]}>
                {bookingLabel ? `${bookingLabel} · ` : ""}
                {ledger.teamName}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={[styles.closeBtn, { borderColor: c.border }]}
              accessibilityRole="button"
            >
              <Text style={[styles.closeText, { color: c.textMuted }]}>Close</Text>
            </Pressable>
          </View>

          {!isCaptain ? (
            <View style={[styles.banner, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#F1F5F9" }]}>
              <Text style={[styles.bannerText, { color: c.textMuted }]}>
                You can see what the squad owes, but only the captain can record what was handed over 👑
              </Text>
            </View>
          ) : null}

          {/* ------------------------------------------------------- the totals */}
          <View style={[styles.totals, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#F1F5F9" }]}>
            <Row label="Total owed" value={formatNPR(totals.due)} color={c.textMuted} />
            <Row label="Collected" value={formatNPR(totals.collected)} color={c.successText} />
            <View style={styles.totalDivider} />
            <Row
              label="Still outstanding"
              value={formatNPR(totals.outstanding)}
              color={totals.outstanding > 0 ? c.dangerText : c.successText}
              strong
            />
          </View>

          {error ? <Text style={[styles.error, { color: c.dangerText }]}>{error}</Text> : null}
          {notice ? (
            <Text style={[styles.notice, { color: c.successText }]}>{notice}</Text>
          ) : null}

          {/* ----------------------------------------------------- the squad */}
          {members.length === 0 ? (
            <Text style={[styles.empty, { color: c.textMuted }]}>
              No shares on this booking yet.
            </Text>
          ) : null}

          {members.map((member) => {
            const settled = member.outstanding <= 0;
            const editing = forId === member.userId;

            return (
              <View
                key={member.userId}
                style={[styles.member, { backgroundColor: c.surface, borderColor: c.border }]}
              >
                <View style={styles.memberHead}>
                  <Avatar
                    size={36}
                    user={{
                      name: member.userName,
                      avatarColor: member.userAvatarColor,
                      avatarUrl: member.userAvatarUrl,
                    }}
                  />
                  <View style={styles.grow}>
                    <Text style={[styles.memberName, { color: c.text }]} numberOfLines={1}>
                      {member.userName}
                      {member.isYou ? "  (you)" : ""}
                    </Text>
                    <Text style={[styles.memberSub, { color: c.textMuted }]}>
                      owes {formatNPR(member.outstanding)}
                      {member.collected > 0 ? ` of ${formatNPR(member.amountDue)}` : ""}
                      {member.userLevel ? ` · ${member.userLevel}` : ""}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.chip,
                      {
                        backgroundColor: settled
                          ? isDark
                            ? "rgba(16,185,129,0.18)"
                            : "#DCFCE7"
                          : isDark
                            ? "rgba(239,68,68,0.18)"
                            : "#FEE2E2",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: settled ? c.successText : c.dangerText },
                      ]}
                    >
                      {settled ? "Settled" : "Owing"}
                    </Text>
                  </View>
                </View>

                {/* the lines this member has handed over */}
                {member.entries.length === 0 ? (
                  <Text style={[styles.noEntries, { color: c.textFaint }]}>
                    Nothing recorded yet.
                  </Text>
                ) : (
                  member.entries.map((entry) => (
                    <View key={entry.id} style={[styles.entry, { borderColor: c.border }]}>
                      <HandCoins size={14} color={c.textFaint} />
                      <View style={styles.grow}>
                        <Text style={[styles.entryMain, { color: c.text }]}>
                          {formatNPR(entry.amount)} · {entry.method}
                        </Text>
                        <Text style={[styles.entrySub, { color: c.textFaint }]}>
                          {entry.createdAt ? entry.createdAt.slice(0, 10) : ""}
                          {entry.note ? ` · ${entry.note}` : ""}
                        </Text>
                      </View>
                      {isCaptain ? (
                        <Pressable
                          onPress={() => voidEntry(entry.id)}
                          disabled={busy !== ""}
                          accessibilityRole="button"
                          accessibilityLabel={`Undo the ${formatNPR(entry.amount)} from ${member.userName}`}
                        >
                          {busy === `void-${entry.id}` ? (
                            <Loader2 size={15} color={c.textFaint} />
                          ) : (
                            <Text style={[styles.undo, { color: c.textFaint }]}>Undo</Text>
                          )}
                        </Pressable>
                      ) : null}
                    </View>
                  ))
                )}

                {member.status === "none" ? (
                  <Text style={[styles.noEntries, { color: c.textFaint }]}>
                    On the roster, but no share was split out for this booking.
                  </Text>
                ) : null}

                {/* one inline form: either the captain keys a member's
                    payment in, or the member settles their own */}
                {editing && selfTo ? (
                  <View style={[styles.form, { borderColor: c.border }]}>
                    <Text style={[styles.formHead, { color: c.text }]}>
                      Your share — {formatNPR(members.find((m) => m.userId === member.userId)?.outstanding ?? 0)} outstanding
                    </Text>
                    <View style={styles.methodRow}>
                      {(["captain", "venue"] as const).map((where) => (
                        <Pressable
                          key={where}
                          onPress={() => setSelfTo(where)}
                          style={[
                            styles.methodChip,
                            {
                              backgroundColor: selfTo === where ? c.primary : c.surface,
                              borderColor: selfTo === where ? c.primary : c.border,
                            },
                          ]}
                          accessibilityRole="button"
                        >
                          <Text
                            style={[
                              styles.methodChipText,
                              { color: selfTo === where ? c.primaryText : c.textMuted },
                            ]}
                          >
                            {where === "captain" ? "To captain" : "To venue"}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={styles.methodRow}>
                      {METHODS.filter((m) => !(selfTo === "venue" && m === "Cash at Venue")).map((m) => (
                        <Pressable
                          key={m}
                          onPress={() => setSelfMethod(m)}
                          style={[
                            styles.methodChip,
                            {
                              backgroundColor: selfMethod === m ? c.primary : c.surface,
                              borderColor: selfMethod === m ? c.primary : c.border,
                            },
                          ]}
                          accessibilityRole="button"
                        >
                          <Text
                            style={[
                              styles.methodChipText,
                              {
                                color:
                                  selfMethod === m ? c.primaryText : c.textMuted,
                              },
                            ]}
                          >
                            {m}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text style={[styles.noEntries, { color: c.textFaint }]}>
                      {selfTo === "venue" && selfMethod !== "Cash at Venue"
                        ? "Recorded on the venue's ledger."
                        : "Recorded on your captain's ledger."}
                    </Text>
                    <View style={styles.formBtns}>
                      <Pressable onPress={closeForm} style={[styles.btnGhost, { borderColor: c.border }]} accessibilityRole="button">
                        <Text style={[styles.btnGhostText, { color: c.textMuted }]}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void settleSelf()}
                        disabled={busy !== ""}
                        style={[styles.btn, { backgroundColor: c.primary }]}
                        accessibilityRole="button"
                      >
                        {busy === "settle" ? (
                          <Loader2 size={15} color={c.primaryText} />
                        ) : (
                          <Text style={styles.btnText}>
                            <CheckCheck size={14} color={c.primaryText} /> Record
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ) : editing ? (
                  <View style={[styles.form, { borderColor: c.border }]}>
                    <Text style={[styles.formHead, { color: c.text }]}>
                      Record what {member.userName} handed over
                    </Text>

                    <TextInput
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType="number-pad"
                      placeholder={`${member.outstanding} (what they still owe)`}
                      placeholderTextColor={c.textFaint}
                      style={inputCls}
                    />

                    <View style={styles.pickerWrap}>
                      <Picker
                        selectedValue={method}
                        onValueChange={(v) => setMethod(String(v))}
                        style={{ color: c.text }}
                      >
                        {METHODS.map((m) => (
                          <Picker.Item key={m} label={m} value={m} />
                        ))}
                      </Picker>
                    </View>

                    <TextInput
                      value={note}
                      onChangeText={setNote}
                      placeholder="Note (optional)"
                      placeholderTextColor={c.textFaint}
                      style={inputCls}
                    />

                    <View style={styles.formBtns}>
                      <Pressable
                        onPress={closeForm}
                        style={[styles.btnGhost, { borderColor: c.border }]}
                        accessibilityRole="button"
                      >
                        <Text style={[styles.btnGhostText, { color: c.textMuted }]}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={collect}
                        disabled={busy !== ""}
                        style={[styles.btn, { backgroundColor: c.primary }]}
                        accessibilityRole="button"
                      >
                        {busy === "collect" ? (
                          <Loader2 size={15} color="#fff" />
                        ) : (
                          <Text style={styles.btnText}>
                            <CheckCheck size={14} color="#fff" /> Record
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ) : isCaptain && !settled && member.status !== "none" ? (
                  <Pressable
                    onPress={() => openFor(member)}
                    style={[styles.recordBtn, { borderColor: c.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Record a payment from ${member.userName}`}
                  >
                    <Plus size={14} color={c.text} />
                    <Text style={[styles.recordText, { color: c.text }]}>Record payment</Text>
                  </Pressable>
                ) : member.isYou && !settled && member.status !== "none" ? (
                  /* Your own share is yours to settle, and either side of it
                     counts: handing the captain cash and paying the remainder
                     at the venue add up to one settled share. */
                  <Pressable
                    onPress={() => {
                      setForId(member.userId);
                      setSelfTo("captain");
                      setSelfMethod("Cash at Venue");
                      setAmount(String(member.outstanding));
                      setError("");
                      setNotice("");
                    }}
                    style={[styles.recordBtn, { borderColor: c.border }]}
                    accessibilityRole="button"
                    accessibilityLabel="Settle your share"
                  >
                    <Wallet size={14} color={c.text} />
                    <Text style={[styles.recordText, { color: c.text }]}>Settle your share</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}

          <View style={styles.footNote}>
            <ReceiptText size={13} color={c.textFaint} />
            <Text style={[styles.footText, { color: c.textFaint }]}>
              Every line here is saved to the database. Undo keeps the old entry on record
              rather than deleting it, so the trail stays trustworthy.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Row({
  label,
  value,
  color,
  strong,
}: {
  label: string;
  value: string;
  color: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color }]}>{label}</Text>
      <Text style={[styles.rowValue, { color }, strong && styles.rowValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: space[4], paddingBottom: space[6], gap: space[3] },
  grow: { flex: 1 },

  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  title: { fontSize: fontSize.lg, fontWeight: "700" },
  sub: { fontSize: fontSize.sm, marginTop: 2 },
  closeBtn: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: space[3], paddingVertical: space[1] },
  closeText: { fontSize: fontSize.sm, fontWeight: "600" },
  closeGhost: { paddingVertical: space[2] },
  closeGhostText: { fontSize: fontSize.sm, fontWeight: "600" },
  backdrop: { flex: 1, backgroundColor: "rgba(2,6,23,0.55)", alignItems: "center", justifyContent: "center", padding: space[4] },
  loadingCard: { borderRadius: radius["2xl"], padding: space[5], alignItems: "center", gap: space[3], minWidth: 240 },

  banner: { borderRadius: radius.lg, padding: space[3] },
  bannerText: { fontSize: fontSize.sm, lineHeight: 18 },

  totals: { borderRadius: radius.lg, padding: space[4], gap: space[2] },
  totalDivider: { height: 1, marginVertical: space[1], backgroundColor: "rgba(127,127,127,0.25)" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowLabel: { fontSize: fontSize.sm },
  rowValue: { fontSize: fontSize.base, fontWeight: "600" },
  rowValueStrong: { fontSize: fontSize.lg, fontWeight: "700" },

  member: { borderRadius: radius.lg, borderWidth: 1, padding: space[3], gap: space[2] },
  memberHead: { flexDirection: "row", alignItems: "center", gap: space[3] },
  memberName: { fontSize: fontSize.base, fontWeight: "700" },
  memberSub: { fontSize: fontSize.sm, marginTop: 1 },
  chip: { borderRadius: radius.full, paddingHorizontal: space[2], paddingVertical: 3 },
  chipText: { fontSize: fontSize.xs, fontWeight: "700" },

  noEntries: { fontSize: fontSize.sm, marginTop: space[1] },
  entry: { flexDirection: "row", alignItems: "center", gap: space[2], borderTopWidth: 1, paddingTop: space[2] },
  entryMain: { fontSize: fontSize.sm, fontWeight: "600" },
  entrySub: { fontSize: fontSize.xs, marginTop: 1 },
  undo: { fontSize: fontSize.sm, fontWeight: "600" },

  form: { borderWidth: 1, borderRadius: radius.lg, padding: space[3], gap: space[2], marginTop: space[1] },
  formHead: { fontSize: fontSize.sm, fontWeight: "700" },
  formBtns: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space[2], marginTop: space[1] },
  input: { borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: space[3], paddingVertical: space[2], fontSize: fontSize.base },
  pickerWrap: { borderWidth: 1, borderRadius: radius.lg, overflow: "hidden" },

  btn: { borderRadius: radius.full, paddingHorizontal: space[4], paddingVertical: space[2] },
  btnText: { color: "#fff", fontSize: fontSize.sm, fontWeight: "700" },
  btnGhost: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: space[4], paddingVertical: space[2] },
  btnGhostText: { fontSize: fontSize.sm, fontWeight: "600" },

  methodRow: { flexDirection: "row", flexWrap: "wrap", gap: space[1] },
  methodChip: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: space[3], paddingVertical: space[1] },
  methodChipText: { fontSize: fontSize.sm, fontWeight: "700" },
  recordBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[1], borderWidth: 1, borderRadius: radius.full, paddingVertical: space[2] },
  recordText: { fontSize: fontSize.sm, fontWeight: "700" },

  empty: { fontSize: fontSize.sm, textAlign: "center", paddingVertical: space[4] },
  error: { fontSize: fontSize.sm, fontWeight: "600" },
  notice: { fontSize: fontSize.sm, fontWeight: "600" },

  footNote: { flexDirection: "row", alignItems: "flex-start", gap: space[2], paddingTop: space[2] },
  footText: { flex: 1, fontSize: fontSize.xs, lineHeight: 16 },
});
