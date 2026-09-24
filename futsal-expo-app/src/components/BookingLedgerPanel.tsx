import {
  CheckCheck,
  Loader2,
  Lock,
  Plus,
  ReceiptText,
  RotateCcw,
  Trash2,
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
import { apiFetch } from "@/lib/api";
import { formatWindowLeft } from "@/lib/booking-ledger";
import { formatNPR } from "@/lib/futsal";
import { fontSize, radius, space } from "@/theme";
import { Picker } from "@react-native-picker/picker";

type ExtraLine = {
  id: number;
  label: string;
  amount: number;
  voidedAt: string | null;
  createdAt: string | null;
};

type PaymentLine = {
  id: number;
  amount: number;
  method: string;
  note: string;
  source: string;
  /** Gateway transaction id, present when the money came in online. */
  reference: string;
  voidedAt: string | null;
  createdAt: string | null;
};

type Ledger = {
  bookingId: number;
  status: string;
  paymentStatus: string;
  courtPrice: number;
  totals: {
    courtPrice: number;
    extrasTotal: number;
    owed: number;
    paid: number;
    balance: number;
    surplus: number;
    byMethod: Record<string, number>;
    settled: boolean;
  };
  window: { settled: boolean; editable: boolean; msLeft: number; locksAt: number | null };
  editWindowMs: number;
  settledAt: string | null;
  settledBy: number | null;
  acceptedMethods: string[];
  defaultExtraFee: number;
  defaultExtraFeeNote: string;
  extras: ExtraLine[];
  payments: PaymentLine[];
};

/**
 * The owner's payment desk for one booking 💸
 *
 * Replaces the old one-click "mark paid". A game is rarely settled in one lump —
 * part arrives by eSewa, part by Khalti, part in cash at the counter — and the
 * final total isn't known until the players have bought their water. So this
 * records each instalment and each add-on as its own line, shows what is still
 * owed as it goes, and only then lets the owner settle.
 *
 * Settling starts a five-minute correction window for the inevitable mistyped
 * amount; after that the ledger locks and the panel says so.
 */
export function BookingLedgerPanel({
  bookingId,
  bookingLabel,
  ownerId,
  onClose,
  onSettled,
}: {
  bookingId: number;
  bookingLabel: string;
  ownerId: number;
  onClose: () => void;
  onSettled?: () => void;
}) {
  const { colors: c, isDark } = useTheme();
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  // Instalment form
  const [method, setMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  // Extra charge form
  const [extraLabel, setExtraLabel] = useState("");
  const [extraAmount, setExtraAmount] = useState("");

  // Ticks so the correction countdown is visible without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // One fetch on open. The form seeds itself off the venue's defaults using
  // functional updates, so the effect doesn't depend on the fields it fills —
  // depending on them would re-run the load every time the owner types.
  useEffect(() => {
    let dead = false;
    apiFetch(`/api/bookings/${bookingId}/ledger`)
      .then(async (res) => {
        const data = await res.json();
        if (dead) return;
        if (!res.ok) {
          setError(String(data.error ?? "Couldn't load the ledger 🙏"));
          return;
        }
        const led = data as Ledger;
        setLedger(led);
        setMethod((m) => m || (led.acceptedMethods[0] ?? ""));
        setExtraLabel((l) => l || led.defaultExtraFeeNote || "");
        setExtraAmount((a) => a || (led.defaultExtraFee ? String(led.defaultExtraFee) : ""));
      })
      .catch(() => {
        if (!dead) setError("Couldn't load the ledger 🙏");
      });
    return () => {
      dead = true;
    };
  }, [bookingId]);

  async function act(body: Record<string, unknown>) {
    setBusy(String(body.action));
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`/api/bookings/${bookingId}/ledger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, actorId: ownerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(data.error ?? "That didn't work 🙏"));
        return;
      }
      if (data.ledger) setLedger(data.ledger as Ledger);
      if (data.message) setNotice(String(data.message));
      // Both directions change what the bookings list renders: settling opens
      // the correction window (and the row's Amend button), and undoing it
      // closes it again and puts the payment status back. Refresh on both, or
      // the row keeps showing a countdown for a state that no longer exists.
      if (body.action === "settle" || body.action === "unsettle") onSettled?.();
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
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable onPress={onClose} style={styles.closeGhost} accessibilityRole="button">
              <Text style={[styles.closeGhostText, { color: c.textMuted }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  const { totals, window: win } = ledger;
  const locked = win.settled && !win.editable;
  const locksIn = win.settled && win.editable ? Math.max(0, (win.locksAt ?? 0) - now) : 0;
  const methods = Object.entries(totals.byMethod);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.flex, { backgroundColor: isDark ? "#0F172A" : "#F8FAFC" }]}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.headerRow}>
            <View style={styles.grow}>
              <Text style={[styles.title, { color: c.text }]}>
                <Wallet size={18} color={c.text} /> Payments
              </Text>
              <Text style={[styles.sub, { color: c.textMuted }]}>{bookingLabel}</Text>
            </View>
            <Pressable onPress={onClose} style={[styles.closeBtn, { borderColor: c.border }]} accessibilityRole="button">
              <Text style={[styles.closeText, { color: c.textMuted }]}>Close</Text>
            </Pressable>
          </View>

          {/* ------------------------------------------------------- the totals */}
          <View style={[styles.totals, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#F1F5F9" }]}>
            <Row label="Court fee" value={formatNPR(totals.courtPrice)} color={c.textMuted} />
            <Row
              label="Extra charges"
              value={totals.extrasTotal > 0 ? `+ ${formatNPR(totals.extrasTotal)}` : "—"}
              color={c.textMuted}
            />
            <View style={styles.totalDivider}>
              <Text style={[styles.owedLabel, { color: c.text }]}>Total owed</Text>
              <Text style={[styles.owedValue, { color: c.text }]}>{formatNPR(totals.owed)}</Text>
            </View>
            <Row
              label="Received"
              value={formatNPR(totals.paid)}
              color={isDark ? "#34D399" : "#059669"}
              strong
            />
            {totals.balance > 0 ? (
              <Text
                style={[
                  styles.banner,
                  styles.bannerDue,
                  isDark && {
                    backgroundColor: "rgba(245,158,11,0.12)",
                    color: "#FCD34D",
                  },
                ]}
              >
                ⏳ {formatNPR(totals.balance)} still to collect
              </Text>
            ) : null}
            {totals.surplus > 0 ? (
              <Text style={[styles.banner, styles.bannerSurplus]}>
                💵 They&apos;ve paid {formatNPR(totals.surplus)} more than owed — hand the change back
              </Text>
            ) : null}
            {totals.balance === 0 && totals.paid > 0 ? (
              <Text style={[styles.banner, styles.bannerOk]}>✅ Fully paid</Text>
            ) : null}
            {methods.length > 0 ? (
              <View style={styles.methodRow}>
                {methods.map(([m, v]) => (
                  <View key={m} style={[styles.methodChip, { backgroundColor: c.surface, borderColor: c.border }]}>
                    <Text style={[styles.methodText, { color: c.textMuted }]}>
                      {m} • {formatNPR(v)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {error ? <Text style={styles.alertError}>{error}</Text> : null}
          {notice ? <Text style={styles.alertOk}>{notice}</Text> : null}

          {locked ? (
            <View style={[styles.lockedBox, { backgroundColor: isDark ? "#1E293B" : "#F1F5F9" }]}>
              <Lock size={14} color={c.textMuted} style={{ marginTop: 2 }} />
              <Text style={[styles.lockedText, { color: c.textMuted }]}>
                Settled {ledger.settledAt ? new Date(ledger.settledAt).toLocaleString() : ""} — the
                correction window closed, so this ledger is locked. That&apos;s what makes the
                day&apos;s takings trustworthy.
              </Text>
            </View>
          ) : null}

          {/* ---------------------------------------------------- instalments */}
          <Text style={[styles.section, { color: c.textFaint }]}>
            Instalments ({totals.paid > 0 ? formatNPR(totals.paid) : "none yet"})
          </Text>
          {ledger.payments.length === 0 ? (
            <Text style={[styles.emptyLine, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#F1F5F9", color: c.textFaint }]}>
              Nothing recorded yet. Add each part as it comes in.
            </Text>
          ) : (
            <View style={{ gap: space[1.5] }}>
              {ledger.payments.map((p) => (
                <View
                  key={p.id}
                  style={[
                    styles.lineItem,
                    {
                      backgroundColor: c.surface,
                      borderColor: c.border,
                      opacity: p.voidedAt ? 0.55 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[styles.lineLabel, { color: p.voidedAt ? c.textFaint : c.text }]}
                    numberOfLines={1}
                  >
                    {p.method}
                    {p.reference ? (
                      <Text style={{ color: c.textFaint }}> • {p.reference.slice(0, 18)}</Text>
                    ) : p.note ? (
                      <Text style={{ color: c.textFaint }}> — {p.note}</Text>
                    ) : null}
                    {p.voidedAt ? " (undone)" : ""}
                  </Text>
                  <Text
                    style={[
                      styles.lineAmt,
                      {
                        color: p.voidedAt ? c.textFaint : c.text,
                        textDecorationLine: p.voidedAt ? "line-through" : "none",
                      },
                    ]}
                  >
                    {formatNPR(p.amount)}
                  </Text>
                  {!p.voidedAt && !locked ? (
                    <Pressable
                      onPress={() => void act({ action: "voidPayment", paymentId: p.id })}
                      disabled={busy === "voidPayment"}
                      accessibilityLabel="Undo this instalment"
                      style={styles.iconBtn}
                    >
                      <RotateCcw size={14} color={c.textFaint} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {!locked ? (
            <View style={styles.payForm}>
              <View style={styles.payFormRow}>
                <View style={[styles.pickerBox, { backgroundColor: c.surface, borderColor: c.border }]}>
                  <Picker
                    selectedValue={method}
                    onValueChange={(v) => setMethod(String(v))}
                    style={{ color: c.text }}
                  >
                    {ledger.acceptedMethods.map((m) => (
                      <Picker.Item key={m} label={m} value={m} />
                    ))}
                  </Picker>
                </View>
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="numeric"
                  placeholder={totals.balance > 0 ? String(totals.balance) : "Amount"}
                  placeholderTextColor={c.textFaint}
                  style={[styles.input, styles.amountInput, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
                />
                <Pressable
                  onPress={() => {
                    void act({ action: "addPayment", method, amount: Number(amount), note });
                    setAmount("");
                    setNote("");
                  }}
                  disabled={busy === "addPayment" || !amount}
                  accessibilityLabel="Record this instalment"
                  style={[styles.addBtn, { opacity: busy === "addPayment" || !amount ? 0.4 : 1 }]}
                >
                  {busy === "addPayment" ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Plus size={14} color="#FFFFFF" />
                  )}
                </Pressable>
              </View>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Note (optional) — e.g. handed over at the counter"
                placeholderTextColor={c.textFaint}
                style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
              />
            </View>
          ) : null}

          {/* ------------------------------------------------- extra charges */}
          <Text style={[styles.section, { color: c.textFaint }]}>Extra charges</Text>
          <Text style={[styles.sectionHelp, { color: c.textFaint }]}>
            The court fee is taken in advance; the water and spare balls aren&apos;t. Add them as
            the game goes and the total owed follows.
          </Text>
          {ledger.extras.length === 0 ? (
            <Text style={[styles.emptyLine, { backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#F1F5F9", color: c.textFaint }]}>
              No extras yet.
            </Text>
          ) : (
            <View style={{ gap: space[1.5] }}>
              {ledger.extras.map((x) => (
                <View
                  key={x.id}
                  style={[
                    styles.lineItem,
                    { backgroundColor: c.surface, borderColor: c.border, opacity: x.voidedAt ? 0.55 : 1 },
                  ]}
                >
                  <Text style={[styles.lineLabel, { color: x.voidedAt ? c.textFaint : c.text }]} numberOfLines={1}>
                    {x.label}
                    {x.voidedAt ? " (removed)" : ""}
                  </Text>
                  <Text
                    style={[
                      styles.lineAmt,
                      {
                        color: x.voidedAt ? c.textFaint : c.text,
                        textDecorationLine: x.voidedAt ? "line-through" : "none",
                      },
                    ]}
                  >
                    {formatNPR(x.amount)}
                  </Text>
                  {!x.voidedAt && !locked ? (
                    <Pressable
                      onPress={() => void act({ action: "voidExtra", extraId: x.id })}
                      disabled={busy === "voidExtra"}
                      accessibilityLabel="Remove this extra charge"
                      style={styles.iconBtn}
                    >
                      <Trash2 size={14} color={c.textFaint} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {!locked ? (
            <View style={styles.extraForm}>
              <TextInput
                value={extraLabel}
                onChangeText={setExtraLabel}
                placeholder="Water x10"
                placeholderTextColor={c.textFaint}
                style={[styles.input, styles.extraLabel, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
              />
              <TextInput
                value={extraAmount}
                onChangeText={setExtraAmount}
                keyboardType="numeric"
                placeholder="Rs."
                placeholderTextColor={c.textFaint}
                style={[styles.input, styles.amountInput, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
              />
              <Pressable
                onPress={() => {
                  void act({ action: "addExtra", label: extraLabel, amount: Number(extraAmount) });
                  setExtraAmount(ledger.defaultExtraFee ? String(ledger.defaultExtraFee) : "");
                }}
                disabled={busy === "addExtra" || !extraLabel.trim() || !extraAmount}
                accessibilityLabel="Add this extra charge"
                style={[styles.addDark, { opacity: busy === "addExtra" || !extraLabel.trim() || !extraAmount ? 0.4 : 1 }]}
              >
                {busy === "addExtra" ? (
                  <ActivityIndicator size="small" color={c.text} />
                ) : (
                  <Plus size={14} color={c.text} />
                )}
              </Pressable>
              {ledger.defaultExtraFee > 0 ? (
                <Text style={[styles.hint, { color: c.textFaint }]}>
                  Your venue&apos;s usual add-on is {formatNPR(ledger.defaultExtraFee)}
                  {ledger.defaultExtraFeeNote ? ` for "${ledger.defaultExtraFeeNote}"` : ""} —
                  prefilled above.
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* -------------------------------------------------------- settle */}
          <View style={styles.settleBox}>
            {!win.settled ? (
              <Pressable
                onPress={() => void act({ action: "settle" })}
                disabled={busy === "settle" || totals.paid <= 0}
                style={[styles.settleBtn, { opacity: busy === "settle" || totals.paid <= 0 ? 0.4 : 1 }]}
              >
                {busy === "settle" ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <CheckCheck size={16} color="#FFFFFF" />
                )}
                <Text style={styles.settleText}>
                  {totals.paid <= 0
                    ? "Record a payment first"
                    : totals.balance > 0
                      ? `Settle with ${formatNPR(totals.balance)} still owed`
                      : "Mark settled ✅"}
                </Text>
              </Pressable>
            ) : win.editable ? (
              <>
                <View style={styles.editWindow}>
                  <ReceiptText size={14} color="#B45309" />
                  <Text style={styles.editWindowText}>
                    Settled — editable for {formatWindowLeft(locksIn)} more, then it locks
                  </Text>
                </View>
                <Pressable
                  onPress={() => void act({ action: "unsettle" })}
                  disabled={busy === "unsettle"}
                  style={[styles.unsettleBtn, { borderColor: c.border, opacity: busy === "unsettle" ? 0.4 : 1 }]}
                >
                  <RotateCcw size={16} color={c.textMuted} />
                  <Text style={[styles.unsettleText, { color: c.textMuted }]}>Undo settlement</Text>
                </Pressable>
              </>
            ) : (
              <View style={[styles.lockedPill, { backgroundColor: isDark ? "#1E293B" : "#F1F5F9" }]}>
                <Lock size={14} color={c.textFaint} />
                <Text style={[styles.lockedPillText, { color: c.textFaint }]}>
                  Settled and locked 🔒
                </Text>
              </View>
            )}
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
    <View style={styles.totalRow}>
      <Text style={{ color, fontSize: fontSize.xs, fontWeight: "700" }}>{label}</Text>
      <Text style={{ color, fontSize: fontSize.xs, fontWeight: strong ? "900" : "700" }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: space[4],
  },
  loadingCard: {
    width: "100%",
    maxWidth: 400,
    borderRadius: radius["3xl"],
    padding: space[8],
    alignItems: "center",
  },
  closeGhost: { marginTop: space[4], padding: space[2] },
  closeGhostText: { fontSize: fontSize.sm, fontWeight: "900" },
  scroll: { padding: space[4], paddingBottom: space[12] },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: fontSize.lg, fontWeight: "900", flexDirection: "row", gap: 6 },
  sub: { fontSize: fontSize.xs, fontWeight: "600", marginTop: 2 },
  closeBtn: {
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  closeText: { fontSize: fontSize.xs, fontWeight: "900" },
  totals: { marginTop: space[4], borderRadius: radius["2xl"], padding: space[4] },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  totalDivider: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "rgba(100,116,139,0.25)",
    paddingTop: space[2],
    marginTop: space[1],
  },
  owedLabel: { fontSize: fontSize.sm, fontWeight: "900" },
  owedValue: { fontSize: fontSize.sm, fontWeight: "900" },
  banner: {
    marginTop: space[2],
    borderRadius: radius.lg,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    fontSize: fontSize.xs,
    fontWeight: "900",
    overflow: "hidden",
  },
  bannerDue: { backgroundColor: "#FEF3C7", color: "#92400E" },
  bannerSurplus: { backgroundColor: "#E0F2FE", color: "#075985" },
  bannerOk: { backgroundColor: "#D1FAE5", color: "#065F46" },
  methodRow: { flexDirection: "row", flexWrap: "wrap", gap: space[1.5], marginTop: space[3] },
  methodChip: {
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: space[2.5],
    paddingVertical: space[1],
  },
  methodText: { fontSize: fontSize.xs, fontWeight: "900" },
  alertError: {
    marginTop: space[3],
    borderRadius: radius["2xl"],
    backgroundColor: "#FEF2F2",
    color: "#DC2626",
    paddingHorizontal: space[3.5],
    paddingVertical: space[2.5],
    fontSize: fontSize.xs,
    fontWeight: "700",
    overflow: "hidden",
  },
  alertOk: {
    marginTop: space[3],
    borderRadius: radius["2xl"],
    backgroundColor: "#ECFDF5",
    color: "#047857",
    paddingHorizontal: space[3.5],
    paddingVertical: space[2.5],
    fontSize: fontSize.xs,
    fontWeight: "700",
    overflow: "hidden",
  },
  lockedBox: {
    marginTop: space[3],
    borderRadius: radius["2xl"],
    paddingHorizontal: space[3.5],
    paddingVertical: space[2.5],
    flexDirection: "row",
    gap: space[2],
  },
  lockedText: { flex: 1, fontSize: fontSize.xs, fontWeight: "700", lineHeight: 17 },
  section: {
    marginTop: space[4],
    fontSize: fontSize.xs,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: space[1.5],
  },
  sectionHelp: { fontSize: fontSize.xs, lineHeight: 16, marginBottom: space[2] },
  emptyLine: {
    borderRadius: radius.xl,
    paddingHorizontal: space[3],
    paddingVertical: space[4],
    textAlign: "center",
    fontSize: fontSize.xs,
    fontWeight: "600",
    overflow: "hidden",
  },
  lineItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  lineLabel: { flex: 1, minWidth: 0, fontSize: fontSize.xs, fontWeight: "700" },
  lineAmt: { fontSize: fontSize.xs, fontWeight: "900" },
  iconBtn: { padding: 4 },
  payForm: { marginTop: space[2], gap: space[2] },
  payFormRow: { flexDirection: "row", gap: space[2], alignItems: "center" },
  pickerBox: {
    flex: 1.2,
    borderRadius: radius.xl,
    borderWidth: 1,
    overflow: "hidden",
    minHeight: 44,
  },
  input: {
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: space[3],
    paddingVertical: space[2.5],
    fontSize: fontSize.sm,
    fontWeight: "600",
    minHeight: 44,
  },
  amountInput: { width: 96, textAlign: "center" },
  extraLabel: { flex: 1 },
  addBtn: {
    width: 72,
    minHeight: 44,
    borderRadius: radius.xl,
    backgroundColor: "#10B981",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  addDark: {
    width: 56,
    minHeight: 44,
    borderRadius: radius.xl,
    backgroundColor: "#0F172A",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  extraForm: {
    marginTop: space[2],
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    alignItems: "center",
  },
  hint: { width: "100%", fontSize: fontSize["2xs"], fontWeight: "700" },
  settleBox: {
    marginTop: space[5],
    borderTopWidth: 1,
    borderTopColor: "rgba(100,116,139,0.2)",
    paddingTop: space[4],
    gap: space[2],
  },
  settleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: radius.xl,
    backgroundColor: "#10B981",
    paddingVertical: space[3],
  },
  settleText: { color: "#FFFFFF", fontSize: fontSize.sm, fontWeight: "900" },
  editWindow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[1.5],
    borderRadius: radius.xl,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: space[3],
    paddingVertical: space[2.5],
  },
  editWindowText: { color: "#92400E", fontSize: fontSize.xs, fontWeight: "900" },
  unsettleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingVertical: space[3],
  },
  unsettleText: { fontSize: fontSize.sm, fontWeight: "900" },
  lockedPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[1.5],
    borderRadius: radius.xl,
    paddingVertical: space[3],
  },
  lockedPillText: { fontSize: fontSize.xs, fontWeight: "900" },
  error: { marginTop: space[3], fontSize: fontSize.sm, fontWeight: "700", color: "#DC2626" },
});
