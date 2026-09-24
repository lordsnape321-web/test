import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Notice, Pill, Spinner } from "@/components/ui";
import { fetchBooking, fetchLedger } from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { ApiError } from "@/lib/api";
import { formatWindowLeft } from "@/lib/booking-ledger";
import { formatNPR, prettyDate } from "@/lib/futsal";
import type { Booking, Ledger } from "@/lib/types";
import { fontSize, space } from "@/theme";

/**
 * Booking detail + payment.
 *
 * The money figures are not recomputed here — they come from the ledger route,
 * which derives owed/paid/balance/surplus from the append-only payment rows.
 * Showing the server's own numbers means the app can never disagree with the
 * database about what is owed.
 *
 * The 5-minute settlement window is rendered with formatWindowLeft from the
 * ported src/lib/booking-ledger.ts, so the wording and the rounding match the
 * web owner studio exactly.
 */
export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const bookingId = Number(id);
  const { colors } = useTheme();
  const { user } = useAuth();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(bookingId)) return;
    try {
      setError(null);
      // fetchBooking reads the player's booking list and picks this id; passing
      // the userId keeps that list small. The route has no GET /:id.
      const [b, l] = await Promise.all([
        fetchBooking(bookingId, user?.id),
        fetchLedger(bookingId),
      ]);
      setBooking(b);
      setLedger(l);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this booking.");
    } finally {
      setLoading(false);
    }
  }, [bookingId, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Pay via a gateway.
   *
   * The web app opens the gateway in a popup and posts the signed callback back.
   * React Native has no popup, so against the sandbox gateways the app calls
   * verify with mockApprove — which runs the identical server path: signature
   * check skipped, ledger row appended, statuses updated, audit trail written.
   * Swapping in a real gateway SDK later changes only this function.
   */
  function pay(method: "esewa" | "khalti") {
    setBusy(method);
    setError(null);
    setSuccess(null);
    // Keep the gateway step visible on native too. The mock screens call the
    // same verify endpoints, then return through the success/callback route.
    const path = method === "esewa"
      ? `/payment/esewa/mock?bookingId=${bookingId}&amount=${encodeURIComponent(String(Math.max(0, ledger?.totals.balance ?? 0)))}`
      : `/payment/khalti/mock?bookingId=${bookingId}&amount=${encodeURIComponent(String(Math.max(0, ledger?.totals.balance ?? 0)))}&pidx=mock-pidx`;
    setBusy(null);
    router.push(path as never);
  }

  if (loading) return <Spinner label="Loading booking…" />;

  if (!booking || !ledger) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]}>
        <View style={styles.pad}>
          <Notice message={error ?? "Booking not found."} />
        </View>
      </SafeAreaView>
    );
  }

  const { totals, window: settleWin } = ledger;
  const balance = totals.balance;
  const canPay = balance > 0 && booking.status !== "cancelled";

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.venue, { color: colors.text }]}>
          {booking.venue?.name ?? "Venue"}
        </Text>
        <Text style={[styles.meta, { color: colors.textMuted }]}>
          {booking.court?.name ?? "Court"} · {prettyDate(booking.date)} · {booking.startTime}–
          {booking.endTime}
        </Text>

        <View style={styles.pillRow}>
          <Pill label={booking.status} tone={booking.status === "confirmed" ? "success" : "warning"} />
          <Pill
            label={booking.paymentStatus.replace("_", " ")}
            tone={balance > 0 ? "danger" : "success"}
          />
        </View>

        {error ? <Notice message={error} /> : null}
        {success ? <Notice message={success} tone="success" /> : null}

        {/* ── ledger ───────────────────────────────────────────────── */}
        <Card style={{ marginTop: space["4"] }}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Payment ledger</Text>
          <MoneyRow label="Court" value={formatNPR(ledger.courtPrice)} colors={colors} />
          {ledger.extras.map((x) => (
            <MoneyRow key={`x${x.id}`} label={x.label} value={formatNPR(x.amount)} colors={colors} />
          ))}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <MoneyRow label="Owed" value={formatNPR(totals.owed)} colors={colors} />
          <MoneyRow label="Paid" value={formatNPR(totals.paid)} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <MoneyRow
            label={balance > 0 ? "Balance due" : "Surplus"}
            value={formatNPR(balance > 0 ? balance : totals.surplus)}
            colors={colors}
            strong
            tone={balance > 0 ? "due" : "credit"}
          />

          {ledger.payments.length > 0 ? (
            <View style={{ marginTop: space["3"] }}>
              <Text style={[styles.subTitle, { color: colors.textMuted }]}>Recorded payments</Text>
              {ledger.payments.map((p) => (
                <View key={p.id} style={styles.payRow}>
                  <Text style={{ color: colors.textMuted, fontSize: fontSize.base }}>
                    {p.method}
                    {p.voidedAt ? " (voided)" : ""}
                  </Text>
                  <Text
                    style={{
                      color: p.voidedAt ? colors.textFaint : colors.text,
                      fontSize: fontSize.base,
                      fontWeight: "600",
                      textDecorationLine: p.voidedAt ? "line-through" : "none",
                    }}
                  >
                    {formatNPR(p.amount)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>

        {/* ── settlement window ────────────────────────────────────── */}
        {settleWin.settled ? (
          <Card>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Settlement</Text>
            <Text style={{ color: colors.textMuted, fontSize: fontSize.base }}>
              {settleWin.editable
                ? `The owner can still correct this for ${formatWindowLeft(settleWin.msLeft)}.`
                : "This booking is settled and locked. No further changes."}
            </Text>
          </Card>
        ) : null}

        {/* ── pay ──────────────────────────────────────────────────── */}
        {canPay ? (
          <>
            <Text style={[styles.section, { color: colors.text }]}>
              Pay {formatNPR(balance)}
            </Text>
            <Button
              label="Pay with eSewa"
              onPress={() => pay("esewa")}
              loading={busy === "esewa"}
              disabled={busy !== null}
            />
            <Button
              label="Pay with Khalti"
              variant="secondary"
              onPress={() => pay("khalti")}
              loading={busy === "khalti"}
              disabled={busy !== null}
              style={{ marginTop: space["2"] }}
            />
            <Text style={[styles.hint, { color: colors.textFaint }]}>
              Sandbox mode — no real money moves. The ledger row, statuses and audit trail are the
              same as a live payment.
            </Text>
          </>
        ) : (
          <Notice
            message={
              booking.status === "cancelled"
                ? "This booking was cancelled."
                : "This booking is fully paid. Enjoy the game! ⚽"
            }
            tone={booking.status === "cancelled" ? "error" : "success"}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MoneyRow({
  label,
  value,
  strong,
  tone,
  colors,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "due" | "credit";
  colors: { text: string; textMuted: string };
}) {
  const color = tone === "due" ? "#B45309" : tone === "credit" ? "#047857" : colors.text;
  return (
    <View style={styles.moneyRow}>
      <Text style={{ color: colors.textMuted, fontSize: fontSize.base }}>{label}</Text>
      <Text
        style={{
          color,
          fontSize: strong ? fontSize.xl : fontSize.base,
          fontWeight: strong ? "700" : "500",
        }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: space["4"], paddingBottom: space["12"] },
  pad: { padding: space["4"] },
  venue: { fontSize: fontSize["3xl"], fontWeight: "700" },
  meta: { fontSize: fontSize.base, marginTop: 2, marginBottom: space["3"] },
  pillRow: { flexDirection: "row", gap: space["2"], marginBottom: space["4"] },
  cardTitle: { fontSize: fontSize.lg, fontWeight: "700", marginBottom: space["2"] },
  subTitle: { fontSize: fontSize.base, fontWeight: "600", marginBottom: space["1"] },
  moneyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  payRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  divider: { height: 1, marginVertical: space["2"] },
  section: { fontSize: fontSize.lg, fontWeight: "700", marginTop: space["6"], marginBottom: space["2"] },
  hint: { fontSize: fontSize.sm, textAlign: "center", marginTop: space["3"], lineHeight: 16 },
});
