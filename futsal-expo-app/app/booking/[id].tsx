import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Notice, Pill, Spinner } from "@/components/ui";
import {
  fetchBooking,
  fetchLedger,
  initiateKhalti,
  verifyEsewa,
  verifyKhalti,
} from "@/api";
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
  async function pay(method: "esewa" | "khalti") {
    setBusy(method);
    setError(null);
    setSuccess(null);
    try {
      if (method === "esewa") {
        await verifyEsewa(bookingId, true);
      } else {
        const init = await initiateKhalti(bookingId);
        const pidx = typeof init.pidx === "string" ? init.pidx : "mock-pidx";
        await verifyKhalti(bookingId, pidx, true);
      }
      setSuccess(
        method === "esewa" ? "eSewa payment recorded ✅" : "Khalti payment recorded ✅",
      );
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Payment failed. Nothing was charged — try again.",
      );
    } finally {
      setBusy(null);
    }
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
        <Card style={{ marginTop: space.lg }}>
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
            <View style={{ marginTop: space.md }}>
              <Text style={[styles.subTitle, { color: colors.textMuted }]}>Recorded payments</Text>
              {ledger.payments.map((p) => (
                <View key={p.id} style={styles.payRow}>
                  <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>
                    {p.method}
                    {p.voidedAt ? " (voided)" : ""}
                  </Text>
                  <Text
                    style={{
                      color: p.voidedAt ? colors.textFaint : colors.text,
                      fontSize: fontSize.sm,
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
            <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>
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
              style={{ marginTop: space.sm }}
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
      <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>{label}</Text>
      <Text
        style={{
          color,
          fontSize: strong ? fontSize.lg : fontSize.sm,
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
  scroll: { padding: space.lg, paddingBottom: space.xxxl },
  pad: { padding: space.lg },
  venue: { fontSize: fontSize.xl, fontWeight: "700" },
  meta: { fontSize: fontSize.sm, marginTop: 2, marginBottom: space.md },
  pillRow: { flexDirection: "row", gap: space.sm, marginBottom: space.lg },
  cardTitle: { fontSize: fontSize.base, fontWeight: "700", marginBottom: space.sm },
  subTitle: { fontSize: fontSize.sm, fontWeight: "600", marginBottom: space.xs },
  moneyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  payRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  divider: { height: 1, marginVertical: space.sm },
  section: { fontSize: fontSize.base, fontWeight: "700", marginTop: space.xl, marginBottom: space.sm },
  hint: { fontSize: fontSize.xs, textAlign: "center", marginTop: space.md, lineHeight: 16 },
});
