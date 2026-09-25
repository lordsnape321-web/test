import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Field, Notice, Pill, Spinner } from "@/components/ui";
import {
  chooseBookingPayment,
  chooseBookingPaymentRequest,
  createBookingPaymentRequest,
  fetchBooking,
  fetchLedger,
} from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { ApiError } from "@/lib/api";
import { formatWindowLeft } from "@/lib/booking-ledger";
import { formatNPR, prettyDate } from "@/lib/futsal";
import type { Booking, Ledger } from "@/lib/types";
import { fontSize, space } from "@/theme";

function paymentStatusLabel(status: string) {
  return String(status || "pending").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function paymentMethodLabel(method?: string | null) {
  if (method === "Cash at Venue") return "Cash at venue";
  if (method === "Free Play 🎁") return "Free play";
  return method || "Not selected";
}

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
  const [requestPayerIds, setRequestPayerIds] = useState<string[]>([]);
  const [requestAmount, setRequestAmount] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [teamDetailsOpen, setTeamDetailsOpen] = useState(false);

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
    if (!booking || !user) return;
    setBusy(method);
    setError(null);
    setSuccess(null);
    try {
      // Keep the gateway step visible on native too. The mock screens call the
      // same verify endpoints, then return through the success/callback route.
      const request = booking.paymentRequests?.find(
        (item) => item.payerId === user.id && item.status === "pending",
      );
      const teamShare = booking.teamPayments?.find((share) => share.userId === user.id);
      if (request) {
        await chooseBookingPaymentRequest(bookingId, request.id, user.id, method === "esewa" ? "eSewa" : "Khalti");
      } else if (!teamShare && booking.advancePaymentRequired && booking.advancePaymentStatus !== "paid") {
        await chooseBookingPayment(bookingId, user.id, method === "esewa" ? "eSewa" : "Khalti");
      }
      const amount = request
        ? request.amountDue
        : teamShare && teamShare.paymentStatus !== "paid"
          ? teamShare.amountDue
          : booking.advancePaymentRequired && booking.advancePaymentStatus !== "paid"
            ? booking.advancePaymentAmount ?? 0
            : Math.max(0, ledger?.totals.balance ?? 0);
      const targetQuery = request
        ? `&paymentRequestId=${request.id}&userId=${user.id}`
        : teamShare && teamShare.paymentStatus !== "paid"
          ? `&teamPaymentId=${teamShare.id}&userId=${user.id}`
          : `&userId=${user.id}`;
      const path = method === "esewa"
        ? `/payment/esewa/mock?bookingId=${bookingId}&amount=${encodeURIComponent(String(amount))}${targetQuery}`
        : `/payment/khalti/mock?bookingId=${bookingId}&amount=${encodeURIComponent(String(amount))}${targetQuery}&pidx=mock-pidx`;
      router.push(path as never);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start this payment.");
      setBusy(null);
    }
  }

  async function requestMoney() {
    if (!booking || !user || booking.userId !== user.id || !booking.teamId) return;
    const payerIds = requestPayerIds.map(Number).filter((value) => Number.isInteger(value) && value > 0);
    const amount = Number(requestAmount);
    if (payerIds.length === 0) {
      setError("Choose at least one teammate first.");
      return;
    }
    if (!Number.isInteger(amount) || amount < 10) {
      setError("Enter at least Rs. 10 from each selected player.");
      return;
    }
    setRequestBusy(true);
    setError(null);
    try {
      await createBookingPaymentRequest(bookingId, {
        requesterId: user.id,
        payerIds,
        amount,
        purpose: booking.advancePaymentRequired && booking.advancePaymentStatus !== "paid" ? "advance" : "booking",
        note: requestNote.trim(),
      });
      setRequestPayerIds([]);
      setRequestAmount("");
      setRequestNote("");
      setSuccess(`Payment request sent to ${payerIds.length} teammate${payerIds.length === 1 ? "" : "s"}. They can pay the venue owner through eSewa or Khalti.`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send the payment request.");
    } finally {
      setRequestBusy(false);
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
  const teamShare = booking.teamPayments?.find((share) => share.userId === user?.id) ?? null;
  const advanceDue = booking.advancePaymentRequired && booking.advancePaymentStatus !== "paid" ? booking.advancePaymentAmount ?? 0 : 0;
  const competitionWaiting = booking.competition?.competitionStatus === "pending";
  const requestedForMe = booking.paymentRequests?.filter(
    (request) => request.payerId === user?.id && request.status === "pending",
  ) ?? [];
  const payRequest = requestedForMe[0] ?? null;
  const payAmount = payRequest
    ? payRequest.amountDue
    : teamShare && teamShare.paymentStatus !== "paid"
      ? teamShare.amountDue
      : advanceDue > 0
        ? advanceDue
        : balance;
  const canPay =
    booking.status !== "cancelled" &&
    booking.status !== "rejected" &&
    !competitionWaiting &&
    requestedForMe.length === 0 &&
    (teamShare
      ? teamShare.paymentStatus !== "paid" && ["eSewa", "Khalti"].includes(teamShare.paymentMethod)
      : advanceDue > 0 || (!booking.advancePaymentRequired && balance > 0));
  const captainCanRequest = Boolean(
    user && booking.teamId && booking.userId === user.id && booking.status !== "cancelled" && booking.status !== "rejected",
  );
  const captainCanViewTeamDetails = Boolean(user && booking.teamId && booking.userId === user.id);
  const teamReceived = (booking.teamPayments ?? []).reduce((sum, share) => sum + Math.max(0, Number(share.paidAmount) || 0), 0);
  const teamDue = (booking.teamPayments ?? []).reduce((sum, share) => sum + Math.max(0, Number(share.amountDue) || 0), 0);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.titleRail}
        >
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.venue, { color: colors.text }]}>
            {booking.venue?.name ?? "Venue"}
          </Text>
        </ScrollView>
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.titleRail}
        >
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.meta, { color: colors.textMuted }]}>
            {booking.court?.name ?? "Court"} · {prettyDate(booking.date)} · {booking.startTime}–
            {booking.endTime}
          </Text>
        </ScrollView>

        <View style={styles.pillRow}>
          <Pill label={booking.status} tone={booking.status === "confirmed" ? "success" : "warning"} />
          <Pill
            label={paymentStatusLabel(booking.paymentStatus)}
            tone={balance > 0 ? "danger" : "success"}
          />
        </View>
        <View style={styles.paymentLabels}>
          <Text style={[styles.paymentLabel, { color: colors.textMuted }]}>Payment method: {paymentMethodLabel(booking.paymentMethod)}</Text>
          <Text style={[styles.paymentLabel, { color: colors.textMuted }]}>Payment status: {paymentStatusLabel(booking.paymentStatus)}</Text>
        </View>

        {error ? <Notice message={error} /> : null}
        {success ? <Notice message={success} tone="success" /> : null}
        {advanceDue > 0 ? (
          <Notice message={`Venue advance requested: ${formatNPR(advanceDue)}. Pay within one hour using eSewa or Khalti only; Cash at Venue cannot satisfy this advance.`} tone="info" />
        ) : booking.advancePaymentRequired && booking.advancePaymentStatus === "paid" ? (
          <Notice message={`Advance verified. Remaining ${formatNPR(Math.max(0, balance))} may be paid at the venue.`} tone="success" />
        ) : null}
        {teamShare ? (
          <Notice
            message={`Team share: ${formatNPR(teamShare.amountDue)}. ${teamShare.paymentStatus === "paid" ? `Verified via ${teamShare.paymentMethod}.` : teamShare.paymentMethod ? `Selected method: ${teamShare.paymentMethod}.` : "Select eSewa, Khalti, or Cash at Venue from My Bookings."}`}
            tone={teamShare.paymentStatus === "paid" ? "success" : "info"}
          />
        ) : null}
        {requestedForMe.map((request) => (
          <Card key={request.id} style={{ marginTop: space["3"] }}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Payment request from {request.requesterName}</Text>
            <Text style={[styles.meta, { color: colors.textMuted }]}>
              Pay {formatNPR(request.amountDue)} directly to {booking.venue?.name ?? "the venue owner"} for {request.purpose === "advance" ? "the venue advance" : "the team booking"}.
            </Text>
            {request.note ? <Text style={[styles.meta, { color: colors.textMuted }]}>Note: {request.note}</Text> : null}
            <Text style={[styles.hint, { color: colors.textFaint }]}>Only eSewa or Khalti is supported for a directed teammate payment.</Text>
            <Button
              label={`Pay ${formatNPR(request.amountDue)} with eSewa`}
              onPress={() => void pay("esewa")}
              loading={busy === "esewa"}
              disabled={busy !== null}
            />
            <Button
              label={`Pay ${formatNPR(request.amountDue)} with Khalti`}
              variant="secondary"
              onPress={() => void pay("khalti")}
              loading={busy === "khalti"}
              disabled={busy !== null}
              style={{ marginTop: space["2"] }}
            />
          </Card>
        ))}
        {captainCanRequest ? (
          <Card style={{ marginTop: space["3"] }}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Ask a teammate to pay</Text>
            <Text style={[styles.meta, { color: colors.textMuted }]}>Choose one player and an exact amount. Their verified eSewa or Khalti payment is recorded against this booking.</Text>
            <Text style={[styles.meta, { color: colors.textMuted }]}>Select one or more teammates. The amount below is requested from each selected player.</Text>
            <View style={styles.playerChoices}>
              {(booking.teamPlayers ?? []).filter((player) => player.id !== user?.id).map((player) => {
                const selected = requestPayerIds.includes(String(player.id));
                return (
                  <Button
                    key={player.id}
                    label={selected ? `✓ ${player.name}` : player.name}
                    variant={selected ? "primary" : "ghost"}
                    onPress={() => setRequestPayerIds((current) => selected ? current.filter((id) => id !== String(player.id)) : [...current, String(player.id)])}
                    style={styles.playerButton}
                  />
                );
              })}
            </View>
            <Field
              label="Amount from each player in NPR"
              value={requestAmount}
              onChangeText={setRequestAmount}
              placeholder="For example, 500"
              keyboardType="numeric"
            />
            <Field
              label="Note (optional)"
              value={requestNote}
              onChangeText={setRequestNote}
              placeholder="What should this cover?"
              multiline
            />
            <Button label="Send payment request" onPress={() => void requestMoney()} loading={requestBusy} disabled={requestBusy} />
          </Card>
        ) : null}

        {captainCanViewTeamDetails ? (
          <Card style={{ marginTop: space["3"] }}>
            <Pressable
              onPress={() => setTeamDetailsOpen((value) => !value)}
              style={styles.teamDetailsHead}
              accessibilityRole="button"
              accessibilityState={{ expanded: teamDetailsOpen }}
            >
              <View style={styles.grow}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>Team payment details</Text>
                <Text style={[styles.meta, { color: colors.textMuted }]}>How your friends chose to pay · {formatNPR(teamReceived)} received of {formatNPR(teamDue)}</Text>
              </View>
              <Text style={[styles.expandText, { color: colors.textMuted }]}>{teamDetailsOpen ? "Hide" : "Open"}</Text>
            </Pressable>
            {teamDetailsOpen ? (
              <View style={styles.teamDetailsBody}>
                <Text style={[styles.subTitle, { color: colors.textMuted }]}>Payment choices by player</Text>
                {(booking.teamPlayers ?? []).map((player) => {
                  const share = booking.teamPayments?.find((item) => item.userId === player.id);
                  const paid = Math.max(0, Number(share?.paidAmount) || 0);
                  const due = Math.max(0, Number(share?.amountDue) || 0);
                  const remaining = Math.max(0, due - paid);
                  return (
                    <View key={player.id} style={[styles.teamPlayerRow, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                      <View style={styles.grow}>
                        <Text style={[styles.teamPlayerName, { color: colors.text }]}>{player.name}{player.role === "captain" ? " · captain" : ""}</Text>
                        <Text style={[styles.meta, { color: colors.textMuted }]}>Due {formatNPR(due)} · Paid {formatNPR(paid)} · Method: {paymentMethodLabel(share?.paymentMethod)}</Text>
                        {remaining > 0 ? <Text style={[styles.teamRemaining, { color: "#B45309" }]}>Remaining {formatNPR(remaining)}</Text> : null}
                        {share?.gatewayTxnId ? <Text style={[styles.hint, { color: colors.textFaint }]}>Gateway reference: {share.gatewayTxnId.slice(0, 18)}</Text> : null}
                      </View>
                      <Pill label={paymentStatusLabel(share?.paymentStatus ?? "not selected")} tone={share?.paymentStatus === "paid" ? "success" : "warning"} />
                    </View>
                  );
                })}
                {(booking.paymentRequests ?? []).length > 0 ? (
                  <View style={{ marginTop: space["3"] }}>
                    <Text style={[styles.subTitle, { color: colors.textMuted }]}>Directed requests</Text>
                    {(booking.paymentRequests ?? []).map((request) => (
                      <View key={request.id} style={[styles.requestDetail, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                        <Text style={[styles.teamPlayerName, { color: colors.text }]}>{request.requesterName} → {request.payerName}: {formatNPR(request.amountDue)}</Text>
                        <Text style={[styles.meta, { color: colors.textMuted }]}>{request.purpose === "advance" ? "Venue advance" : "Team booking"} · {paymentMethodLabel(request.paymentMethod)} · {paymentStatusLabel(request.status)} · Paid {formatNPR(request.paidAmount)}</Text>
                        {request.note ? <Text style={[styles.hint, { color: colors.textFaint }]}>Note: {request.note}</Text> : null}
                        {request.gatewayTxnId ? <Text style={[styles.hint, { color: colors.textFaint }]}>Gateway reference: {request.gatewayTxnId.slice(0, 18)}</Text> : null}
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </Card>
        ) : null}

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
                    {paymentMethodLabel(p.method)}
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
              Pay {formatNPR(payAmount)}
            </Text>
            {teamShare ? (
              teamShare.paymentMethod === "eSewa" ? (
                <Button
                  label="Pay team share with eSewa"
                  onPress={() => pay("esewa")}
                  loading={busy === "esewa"}
                  disabled={busy !== null}
                />
              ) : (
                <Button
                  label="Pay team share with Khalti"
                  variant="secondary"
                  onPress={() => pay("khalti")}
                  loading={busy === "khalti"}
                  disabled={busy !== null}
                />
              )
            ) : (
              <>
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
              </>
            )}
            <Text style={[styles.hint, { color: colors.textFaint }]}>
              Sandbox mode — no real money moves. The ledger row, statuses and audit trail are the
              same as a live payment.
            </Text>
          </>
        ) : (
          <Notice
            message={
              competitionWaiting
                ? "Waiting for the opposition captain to accept this competition request. Payment opens only after acceptance."
                : booking.status === "cancelled"
                  ? "This booking was cancelled."
                  : booking.status === "rejected"
                    ? "This competition request was declined and was not sent to the venue owner."
                    : "This booking is fully paid. Enjoy the game! ⚽"
            }
            tone={competitionWaiting || booking.status === "cancelled" || booking.status === "rejected" ? "error" : "success"}
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
  titleRail: { maxWidth: "100%", flexShrink: 1 },
  venue: { fontSize: fontSize["3xl"], fontWeight: "700" },
  meta: { fontSize: fontSize.base, marginTop: 2, marginBottom: space["3"] },
  pillRow: { flexDirection: "row", gap: space["2"], marginBottom: space["2"] },
  paymentLabels: { flexDirection: "row", flexWrap: "wrap", gap: space["2"], marginBottom: space["2"] },
  paymentLabel: { fontSize: fontSize.sm, fontWeight: "600" },
  cardTitle: { fontSize: fontSize.lg, fontWeight: "700", marginBottom: space["2"] },
  subTitle: { fontSize: fontSize.base, fontWeight: "600", marginBottom: space["1"] },
  grow: { flex: 1, minWidth: 0 },
  teamDetailsHead: { flexDirection: "row", alignItems: "center", gap: space["2"] },
  expandText: { fontSize: fontSize.sm, fontWeight: "800" },
  teamDetailsBody: { marginTop: space["3"], gap: space["2"] },
  teamPlayerRow: { flexDirection: "row", alignItems: "center", gap: space["2"], borderWidth: 1, borderRadius: 12, padding: space["3"] },
  teamPlayerName: { fontSize: fontSize.sm, fontWeight: "800" },
  teamRemaining: { fontSize: fontSize.sm, fontWeight: "800", marginTop: 2 },
  requestDetail: { borderWidth: 1, borderRadius: 12, padding: space["3"], marginTop: space["2"] },
  moneyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  payRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  divider: { height: 1, marginVertical: space["2"] },
  section: { fontSize: fontSize.lg, fontWeight: "700", marginTop: space["6"], marginBottom: space["2"] },
  hint: { fontSize: fontSize.sm, textAlign: "center", marginTop: space["3"], lineHeight: 16 },
  playerChoices: { flexDirection: "row", flexWrap: "wrap", gap: space["2"], marginBottom: space["3"] },
  playerButton: { flexGrow: 1, minWidth: "42%" },
});
