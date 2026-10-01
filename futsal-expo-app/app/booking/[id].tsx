import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BookingVenueName } from "@/components/BookingVenueName";
import TeamLedgerPanel from "@/components/TeamLedgerPanel";
import { Button, Card, Field, Notice, Pill, Spinner } from "@/components/ui";
import {
  cancelBookingPaymentRequest,
  attachBookingTeam,
  chooseBookingPayment,
  chooseBookingTeamPayment,
  chooseBookingPaymentRequest,
  createBookingPaymentRequest,
  fetchBooking,
  fetchLedger,
  fetchUserTeams,
  settleTeamShare,
} from "@/api";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { ApiError } from "@/lib/api";
import { prepareGatewayTab, realGatewayEnabled, startGatewayCheckout } from "@/lib/checkout";
import { formatWindowLeft } from "@/lib/booking-ledger";
import { formatNPR, formatTime12, prettyDate } from "@/lib/futsal";
import { locationLabel } from "@/lib/location";
import { openLocation } from "@/lib/open-location";
import { advanceOf, askPlan } from "@/lib/booking-advance";
import { moneyOf } from "@/lib/money";
import type { Booking, Ledger, UserTeamLite } from "@/lib/types";
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
  // Settling your own share: to the captain in cash, or straight at the venue.
  const [settleTo, setSettleTo] = useState<"captain" | "venue" | null>(null);
  const [settleMethod, setSettleMethod] = useState("Cash at Venue");
  const [settleBusy, setSettleBusy] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);
  // The captain's own money ledger for this team booking.
  const [squadLedgerOpen, setSquadLedgerOpen] = useState(false);
  const [requestPayerIds, setRequestPayerIds] = useState<string[]>([]);
  const [requestAmount, setRequestAmount] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  // The owner's advance, the squad list and its actions are part of the
  // booking itself: nothing here hides behind a Show/Hide tap.
  const [teamDetailsOpen, setTeamDetailsOpen] = useState(true);
  // "Booked without a team" recovery: pick a squad and split the cost.
  const [teamChoices, setTeamChoices] = useState<UserTeamLite[] | null>(null);
  const [teamPickBusy, setTeamPickBusy] = useState<number | null>(null);
  const [teamPickError, setTeamPickError] = useState<string | null>(null);

  // One refresh at a time: the focus poll and a just-finished action must not
  // race each other into a stale response.
  const inFlight = useRef(false);
  // Set when a refresh is requested while one is already running (a poll and a
  // just-completed action can overlap): the newest request wins, so the screen
  // can never settle on the pre-action numbers.
  const queued = useRef(false);
  // Polling pauses while a checkout or a ledger write is in flight, and while
  // the ledger panel (which polls on its own) is open.
  const mutating = useRef(false);

  const load = useCallback(async (refresh = false, silent = false) => {
    if (!Number.isFinite(bookingId)) return;
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    // An action's own reload clears the banner it may have just shown; a
    // background poll leaves the last real error alone.
    if (!silent) setError(null);
    try {
      // fetchBooking reads the player's booking list and picks this id; passing
      // the userId keeps that list small. The route has no GET /:id.
      const [b, l] = await Promise.all([
        fetchBooking(bookingId, user?.id, refresh),
        fetchLedger(bookingId, refresh),
      ]);
      setBooking(b);
      setLedger(l);
      setBusy(null);
    } catch (e) {
      // A background poll never replaces the screen with an error banner; the
      // next tick can still recover. Actions do report their failures.
      if (!silent) setError(e instanceof ApiError ? e.message : "Could not load this booking.");
    } finally {
      inFlight.current = false;
      setLoading(false);
      if (queued.current) {
        queued.current = false;
        void load(true);
      }
    }
  }, [bookingId, user?.id]);

  // Mirrored into a ref so the interval below reads the current value without
  // being torn down and re-created on every keystroke in the request form.
  useEffect(() => {
    mutating.current = busy !== null || requestBusy || settleBusy || squadLedgerOpen;
  });

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Refresh on focus, then keep the screen live while it is on top.
   *
   * Without the interval a teammate's verified payment — or the owner's answer,
   * or another device's ledger write — only appeared after navigating away and
   * back. Four seconds matches the My Bookings feed, so both screens settle on
   * the same numbers. The server response stays the only source of truth: this
   * loop re-reads, it never patches a status locally.
   */
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void load(true);
      const timer = setInterval(() => {
        if (!active || mutating.current || AppState.currentState !== "active") return;
        void load(true, true);
      }, 4000);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, [load])
  );

  /**
   * Pay via a gateway.
   *
   * The real test servers — eSewa UAT and Khalti's sandbox — are the default:
   * the server builds a session for this exact target, the browser is sent to
   * the gateway, and the gateway returns it to a screen that verifies the
   * payment before anything is marked paid. When the server cannot reach the
   * gateway it answers `mock: true` and the app falls through to the local
   * simulator below, so a checkout always has somewhere to go.
   */
  async function pay(method: "esewa" | "khalti", target: "auto" | "advance" = "auto", requestId?: number) {
    if (!booking || !user) return;
    setBusy(method);
    setError(null);
    setSuccess(null);
    // Reserve the browser tab while the tap that started this is still live.
    prepareGatewayTab();
    try {
      // Keep the gateway step visible on native too. The mock screens call the
      // same verify endpoints, then return through the success/callback route.
      const payingAdvance = target === "advance" && booking.userId === user.id;
      const request = payingAdvance ? undefined : booking.paymentRequests?.find(
        (item) => item.payerId === user.id && item.status === "pending" && (!requestId || item.id === requestId),
      );
      const teamShare = payingAdvance ? undefined : booking.teamPayments?.find((share) => share.userId === user.id);
      if (request) {
        await chooseBookingPaymentRequest(bookingId, request.id, user.id, method === "esewa" ? "eSewa" : "Khalti");
      } else if (teamShare) {
        await chooseBookingTeamPayment(bookingId, user.id, method === "esewa" ? "eSewa" : "Khalti");
      } else {
        await chooseBookingPayment(bookingId, user.id, method === "esewa" ? "eSewa" : "Khalti");
      }
      const amount = request
        ? request.amountDue
        : teamShare && teamShare.paymentStatus !== "paid"
          ? Math.max(0, teamShare.amountDue - teamShare.paidAmount)
          : booking.advancePaymentRequired && booking.advancePaymentStatus !== "paid"
            ? advanceOf(booking, ledger?.totals.paid ?? 0).remaining
            : Math.max(0, ledger?.totals.balance ?? 0);
      const targetQuery = payingAdvance
        ? `&userId=${user.id}&paymentPurpose=advance`
        : request
        ? `&paymentRequestId=${request.id}&userId=${user.id}`
        : teamShare && teamShare.paymentStatus !== "paid"
          ? `&teamPaymentId=${teamShare.id}&userId=${user.id}`
          : `&userId=${user.id}`;
      if (realGatewayEnabled()) {
        const outcome = await startGatewayCheckout(method, {
          bookingId,
          userId: user.id,
          teamPaymentId: !payingAdvance && teamShare && teamShare.paymentStatus !== "paid" ? teamShare.id : undefined,
          paymentRequestId: request?.id,
          paymentPurpose: payingAdvance ? "advance" : undefined,
        });

        if (outcome.status === "gateway") {
          setBusy(null);
          return;
        }

        if (outcome.status === "error") {
          setError(outcome.message);
          setBusy(null);
          return;
        }

        // outcome.status === "simulator" — fall through to the mock screen.
      }

      const path = method === "esewa"
        ? `/payment/esewa/mock?bookingId=${bookingId}&amount=${encodeURIComponent(String(amount))}${targetQuery}`
        : `/payment/khalti/mock?bookingId=${bookingId}&amount=${encodeURIComponent(String(amount))}${targetQuery}&pidx=mock-pidx`;
      router.push(path as never);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start this payment.");
      setBusy(null);
    }
  }

  async function cancelRequest(requestId: number) {
    if (!user) return;
    setRequestBusy(true);
    setError(null);
    try {
      await cancelBookingPaymentRequest(bookingId, requestId, user.id);
      await load(true);
      setSuccess("Request cancelled. Its history is kept on this booking.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel this request.");
    } finally {
      setRequestBusy(false);
    }
  }

  /**
   * Ask one listed player for their part of this booking.
   *
   * The purpose follows where the money is actually owed: the venue advance
   * while it is unpaid, the venue balance while the venue is still short, and
   * otherwise a reimbursement to the player who paid the bill — which is what
   * "I paid it all, collect later" needs, and why it cannot go through a
   * gateway.
   */
  async function askTeammate(payerId: number, dueAmount: number, alreadyPaid: number): Promise<string> {
    if (!booking || !user) throw new Error("Sign in to ask a teammate.");
    const player = (booking.teamPlayers ?? []).find((item) => item.id === payerId);
    const name = player?.name ?? "Your teammate";
    const share = Math.max(0, Math.round(dueAmount - alreadyPaid));
    const currentAdvance = advanceOf(booking, ledger?.totals.paid ?? 0);
    const plan = askPlan(currentAdvance.remaining, Math.max(0, ledger?.totals.balance ?? 0), share, 0);
    const { purpose, amount } = plan;
    if (!Number.isInteger(amount) || amount < 10) {
      throw new Error(`Nothing left to ask ${name} for — their part is already covered.`);
    }
    setRequestBusy(true);
    setError(null);
    try {
      await createBookingPaymentRequest(bookingId, {
        requesterId: user.id,
        payerIds: [payerId],
        amount,
        purpose,
        note: "",
      });
      await load(true);
      return purpose === "reimbursement"
        ? `${name} was asked to reimburse ${formatNPR(amount)} to you. Record it here once you have it.`
        : `${name} was asked to pay ${formatNPR(amount)}${purpose === "advance" ? " toward the venue advance" : " toward the booking"}.`;
    } finally {
      setRequestBusy(false);
    }
  }

  async function openTeamChoices() {
    if (!user) return;
    setTeamPickError(null);
    setTeamChoices([]);
    try {
      setTeamChoices(await fetchUserTeams(user.id));
    } catch (e) {
      setTeamPickError(e instanceof Error ? e.message : "Could not load your teams.");
    }
  }

  async function chooseTeam(teamId: number) {
    if (!user) return;
    setTeamPickBusy(teamId);
    setTeamPickError(null);
    try {
      await attachBookingTeam(bookingId, user.id, teamId);
      setTeamChoices(null);
      setSuccess("Team added — the cost is split across the squad, so you can ask teammates to pay their part.");
      await load(true);
    } catch (e) {
      setTeamPickError(e instanceof Error ? e.message : "Could not add that team.");
    } finally {
      setTeamPickBusy(null);
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
    const advance = advanceOf(booking, ledger?.totals.paid ?? 0);
    if (advance.active && amount * payerIds.length > advance.available) {
      setError(`Only ${formatNPR(advance.available)} is available to request toward the advance.`);
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
      await load(true);
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

  // The card and this page derive the same word from the same helper, so the
  // pill here can never contradict the card. For a team booking the helper
  // looks at the players' shares (captain or venue — both settle the player),
  // not the venue's desk ledger alone.
  const money = moneyOf(booking);
  const isTeamBooking = (booking.teamPayments?.length ?? 0) > 0;
  const squadDue = money.received + money.balance;
  const teamShare = booking.teamPayments?.find((share) => share.userId === user?.id) ?? null;
  // For a team game the player's obligation is their OWN share. Once it is
  // paid the pill must say "Paid" — the squad's remaining balance belongs to
  // the other members and would read as "still due" after they had just paid.
  const statusView = teamShare
    ? teamShare.paymentStatus === "paid"
      ? { status: "paid" as const, label: "Paid" }
      : (() => {
          const due = Math.max(0, Number(teamShare.amountDue ?? 0));
          const paid = Math.min(due, Math.max(0, Number(teamShare.paidAmount ?? 0)));
          return {
            status: (paid > 0 ? "deposit_paid" : "pending") as "deposit_paid" | "pending",
            label:
              paid > 0
                ? `Your share · ${formatNPR(due - paid)} left`
                : `Your share · ${formatNPR(due)} due`,
          };
        })()
    : { status: money.status, label: money.label };
  const advance = advanceOf(booking, totals.paid);
  const advanceDue = advance.active ? advance.remaining : 0;
  const isBooker = booking.userId === user?.id;
  const competitionWaiting = booking.competition?.competitionStatus === "pending";
  const requestedForMe = booking.paymentRequests?.filter(
    (request) => request.payerId === user?.id && request.status === "pending",
  ) ?? [];
  const payRequest = requestedForMe[0] ?? null;
  const payAmount = payRequest
    ? payRequest.amountDue
    : teamShare && teamShare.paymentStatus !== "paid"
      ? Math.max(0, teamShare.amountDue - teamShare.paidAmount)
      : advanceDue > 0
        ? advanceDue
        : balance;
  const canPay =
    booking.status !== "cancelled" &&
    booking.status !== "rejected" &&
    !competitionWaiting &&
    !(isBooker && advance.active) &&
    requestedForMe.length === 0 &&
    (teamShare
      ? teamShare.paymentStatus !== "paid" && ["eSewa", "Khalti"].includes(teamShare.paymentMethod)
      : advanceDue > 0 || (!booking.advancePaymentRequired && balance > 0));
  async function settleShare() {
    if (!user || !teamShare || !settleTo) return;
    setSettleBusy(true);
    setSettleError(null);
    try {
      const res = await settleTeamShare(bookingId, user.id, {
        actorId: user.id,
        paidTo: settleTo,
        method: settleMethod,
      });
      setSuccess(res.message ?? "Share settled ✅");
      setSettleTo(null);
      await load(true);
    } catch (e) {
      setSettleError(e instanceof Error ? e.message : "Couldn't record that payment 🙏");
    } finally {
      setSettleBusy(false);
    }
  }

  const pendingFor = (playerId: number) =>
    (booking.paymentRequests ?? []).filter((request) => request.payerId === playerId && request.status === "pending");
  const captainCanRequest = Boolean(
    user && booking.teamId && isBooker && !competitionWaiting && !["cancelled", "rejected", "completed"].includes(booking.status),
  );
  const captainCanViewTeamDetails = Boolean(user && booking.userId === user.id);
  const teamReceived = (booking.teamPayments ?? []).reduce((sum, share) => sum + Math.max(0, Number(share.paidAmount) || 0), 0);
  const teamDue = (booking.teamPayments ?? []).reduce((sum, share) => sum + Math.max(0, Number(share.amountDue) || 0), 0);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <BookingVenueName name={booking.venue?.name} color={colors.text} />
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.titleRail}
        >
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.meta, { color: colors.textMuted }]}>
            {booking.court?.name ?? "Court"} · {prettyDate(booking.date)} ·{" "}
            {formatTime12(booking.startTime)}–{formatTime12(booking.endTime || booking.startTime)}
          </Text>
        </ScrollView>

        {locationLabel(booking.venue?.locationUrl, booking.venue?.address, booking.venue?.city) ? (
          <Pressable
            onPress={() =>
              void openLocation(booking.venue?.locationUrl, booking.venue?.address, booking.venue?.city)
            }
            style={[styles.locationBox, { borderColor: colors.border, backgroundColor: colors.inset }]}
            accessibilityRole="link"
            accessibilityLabel="Open the venue in Maps"
          >
            <Text style={[styles.locationText, { color: colors.text }]} numberOfLines={1}>
              📍 {locationLabel(booking.venue?.locationUrl, booking.venue?.address, booking.venue?.city)}
            </Text>
            <Text style={[styles.locationAction, { color: colors.successText }]}>Open in Maps ↗</Text>
          </Pressable>
        ) : null}

        {/*
          Both pills used to read "Pending" on a fresh request — the booking's own
          status and the payment's, side by side. Naming what each one is costs
          nothing and stops the card looking like it says pending twice.
        */}
        <View style={styles.pillRow}>
          <Pill
            label={`Booking ${booking.status}`}
            tone={booking.status === "confirmed" ? "success" : "warning"}
          />
          <Pill
            label={`Payment · ${statusView.label}`}
            tone={statusView.status === "paid" ? "success" : statusView.status === "deposit_paid" ? "warning" : "danger"}
          />
        </View>
        <View style={styles.paymentLabels}>
          {/*
            Team games are paid per player, so the booking-level method (the
            booker's original choice) is wrong to show — it stayed "Cash at
            venue" long after a player paid eSewa. Show the method on the
            player's own share instead, which is what they actually paid with.
          */}
          <Text style={[styles.paymentLabel, { color: colors.textMuted }]}>
            Payment method: {isTeamBooking
              ? (teamShare?.paymentMethod
                  ? `${paymentMethodLabel(teamShare.paymentMethod)} (your share)`
                  : "Per player — see team details")
              : paymentMethodLabel(booking.paymentMethod)}
          </Text>
        </View>

        {error ? <Notice message={error} /> : null}
        {success ? <Notice message={success} tone="success" /> : null}
        {booking.advancePaymentRequired ? (
          <Card style={{ marginTop: space["3"] }}>
            <View style={{ gap: space["3"] }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Venue advance</Text>
              <Text style={[styles.meta, { color: colors.textMuted }]}>{booking.venue?.name ?? "The owner"} requested an advance before confirming this booking.</Text>
              <MoneyRow label="Advance requested" value={formatNPR(advance.requested)} colors={colors} />
              <MoneyRow label="Received by venue" value={formatNPR(advance.received)} colors={colors} />
              <MoneyRow label="Advance remaining" value={formatNPR(advance.remaining)} colors={colors} />
              <Pill
                label={`Advance · ${paymentStatusLabel(booking.advancePaymentStatus ?? "pending")}`}
                tone={advance.remaining === 0 ? "success" : "warning"}
              />
              {advance.active ? (
                <>
                  <Text style={[styles.hint, { color: colors.textMuted }]}>
                    {booking.advancePaymentRequestedAt ? `Pay by ${new Date(new Date(booking.advancePaymentRequestedAt).getTime() + 30 * 60 * 1000).toLocaleString()}. ` : "Pay within 30 minutes of the owner's request. "}
                    Only verified eSewa or Khalti payments to the venue count. Cash held by the captain does not cover this advance.
                  </Text>
                  {isBooker && !competitionWaiting ? (
                    <>
                      <Text style={[styles.subTitle, { color: colors.text }]}>Pay myself</Text>
                      <Button label={`Pay advance ${formatNPR(advance.remaining)} · eSewa`} onPress={() => void pay("esewa", "advance")} disabled={busy !== null} loading={busy === "esewa"} />
                      <Button label={`Pay advance ${formatNPR(advance.remaining)} · Khalti`} variant="secondary" onPress={() => void pay("khalti", "advance")} disabled={busy !== null} loading={busy === "khalti"} />
                      {captainCanRequest ? (
                        <Text style={[styles.hint, { color: colors.textMuted }]}>Ask each teammate for their contribution in the form below — every request is saved against this booking.</Text>
                      ) : <Text style={[styles.hint, { color: colors.textMuted }]}>Teammate requests are available for bookings linked to a team.</Text>}
                      {advance.pending > 0 ? <Text style={[styles.hint, { color: colors.textMuted }]}>Awaiting {formatNPR(advance.pending)} from teammates. You can cover the remaining advance yourself; unpaid requests that are no longer needed will be cancelled.</Text> : null}
                    </>
                  ) : null}
                </>
              ) : <Text style={[styles.meta, { color: colors.textMuted }]}>{advance.remaining === 0 ? `Advance covered. Venue balance: ${formatNPR(balance)}.` : "This booking is no longer collecting an advance."}</Text>}
              {advance.requests.map((request) => (
                <View key={request.id} style={[styles.requestDetail, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                  <Text style={[styles.teamPlayerName, { color: colors.text }]}>{request.payerName} · {formatNPR(request.amountDue)}</Text>
                  <Text style={[styles.meta, { color: colors.textMuted }]}>{paymentStatusLabel(request.status)} · Paid {formatNPR(request.paidAmount)} · {paymentMethodLabel(request.paymentMethod)}</Text>
                  {isBooker && request.status === "pending" ? <Button label="Cancel request" variant="ghost" onPress={() => void cancelRequest(request.id)} disabled={requestBusy} /> : null}
                </View>
              ))}
            </View>
          </Card>
        ) : null}
        {(booking.status === "cancelled" || booking.status === "rejected") && (booking.cancellationReceivedAmount ?? 0) > 0 ? (
          <Notice message={`Received ${formatNPR(booking.cancellationReceivedAmount ?? 0)} before cancellation. Refund status: ${paymentStatusLabel(booking.cancellationMoneyStatus ?? "review")}.`} tone="info" />
        ) : null}
        {isBooker && !booking.teamId && !["cancelled", "rejected", "completed"].includes(booking.status) ? (
          <Card style={{ marginTop: space["3"] }}>
            <View style={{ gap: space["3"] }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Booked without a team?</Text>
              <Text style={[styles.meta, { color: colors.textMuted }]}>
                Attaching your squad splits this booking's cost exactly as it would have at
                checkout. You can then ask teammates to pay their part and open the player ledger.
              </Text>
              {teamPickError ? <Notice message={teamPickError} /> : null}
              <Button
                label={teamChoices ? "Hide team list" : "Select team"}
                variant="secondary"
                onPress={() => (teamChoices ? setTeamChoices(null) : void openTeamChoices())}
              />
              {(teamChoices ?? []).map((team) => (
                <Button
                  key={team.id}
                  label={`${team.name} · ${team.memberCount} member${team.memberCount === 1 ? "" : "s"}`}
                  onPress={() => void chooseTeam(team.id)}
                  loading={teamPickBusy === team.id}
                  disabled={teamPickBusy !== null}
                />
              ))}
              {teamChoices && teamChoices.length === 0 ? (
                <Text style={[styles.hint, { color: colors.textMuted }]}>
                  You aren't in a team yet — create one from the Teams tab, then come back here.
                </Text>
              ) : null}
            </View>
          </Card>
        ) : null}
        {teamShare ? (
          <Notice
            message={`Team share: ${formatNPR(teamShare.amountDue)}. ${teamShare.paymentStatus === "paid" ? `Verified via ${teamShare.paymentMethod}.` : teamShare.paymentMethod ? `Selected method: ${teamShare.paymentMethod}.` : "Select eSewa, Khalti, or Cash at Venue from My Bookings."}`}
            tone={teamShare.paymentStatus === "paid" ? "success" : "info"}
          />
        ) : null}
        {isTeamBooking && user && !teamShare ? (
          <Notice
            message="Your account isn't on this squad's payment list, so the pay button settles the venue's balance — not a player share — and the status stays 'Nothing paid yet'. Ask the captain to add you to the squad, then your share will show here."
            tone="info"
          />
        ) : null}
        {teamShare && teamShare.paymentStatus !== "paid" && !advance.active ? (
          <Card style={{ marginTop: space["3"] }}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Settle your share</Text>
            <Text style={[styles.meta, { color: colors.textMuted }]}>
              {formatNPR(teamShare.amountDue - teamShare.paidAmount)} outstanding. Hand it to{" "}
              {booking.userId === user?.id ? "the captain" : "your captain"} in cash, or pay the venue
              directly — either way it is recorded against this booking and adds up, so paying in two
              places still reads as one settled share.
            </Text>

            {settleError ? <Notice message={settleError} tone="error" /> : null}

            {settleTo ? (
              <View style={{ gap: space["3"] }}>
                <View style={styles.playerChoices}>
                  {(["captain", "venue"] as const).map((where) => (
                    <Button
                      key={where}
                      label={where === "captain" ? "To the captain" : "To the venue"}
                      variant={settleTo === where ? "primary" : "ghost"}
                      onPress={() => setSettleTo(where)}
                      style={styles.playerButton}
                    />
                  ))}
                </View>

                <View style={styles.playerChoices}>
                  {(["Cash at Venue", "eSewa", "Khalti"] as const)
                    .filter((m) => !(settleTo === "venue" && m === "Cash at Venue"))
                    .map((m) => (
                      <Button
                        key={m}
                        label={m}
                        variant={settleMethod === m ? "primary" : "ghost"}
                        onPress={() => setSettleMethod(m)}
                        style={styles.playerButton}
                      />
                    ))}
                </View>
                <Text style={[styles.hint, { color: colors.textFaint }]}>
                  {settleTo === "venue" && settleMethod !== "Cash at Venue"
                    ? "Card payment at the venue is recorded on the venue's ledger."
                    : "Cash handed over is recorded on your captain's ledger."}
                </Text>

                <Button
                  label={`Record ${formatNPR(teamShare.amountDue - teamShare.paidAmount)} as ${settleMethod}`}
                  onPress={() => void settleShare()}
                  loading={settleBusy}
                  disabled={settleBusy}
                />
                <Button label="Cancel" variant="ghost" onPress={() => setSettleTo(null)} />
              </View>
            ) : (
              <Button label="Record a payment" onPress={() => setSettleTo("captain")} />
            )}
          </Card>
        ) : null}
        {requestedForMe.map((request) => (
          <Card key={request.id} style={{ marginTop: space["3"] }}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Payment request from {request.requesterName}</Text>
            <Text style={[styles.meta, { color: colors.textMuted }]}>
              {request.purpose === "reimbursement"
                ? `${request.requesterName} paid the venue for this booking. Settle ${formatNPR(request.amountDue)} with them directly — cash or a transfer — and they will record it in the player ledger.`
                : `Pay ${formatNPR(request.amountDue)} directly to ${booking.venue?.name ?? "the venue owner"} for ${request.purpose === "advance" ? "the venue advance" : "the team booking"}.`}
            </Text>
            {request.note ? <Text style={[styles.meta, { color: colors.textMuted }]}>Note: {request.note}</Text> : null}
            {request.purpose === "reimbursement" ? (
              <Text style={[styles.hint, { color: colors.textFaint }]}>No gateway is needed: the venue has already been paid, so this money goes back to {request.requesterName}.</Text>
            ) : (
              <>
                <Text style={[styles.hint, { color: colors.textFaint }]}>Only eSewa or Khalti is supported for a directed teammate payment.</Text>
                <Button
                  label={`Pay ${formatNPR(request.amountDue)} with eSewa`}
                  onPress={() => void pay("esewa", "auto", request.id)}
                  loading={busy === "esewa"}
                  disabled={busy !== null}
                />
                <Button
                  label={`Pay ${formatNPR(request.amountDue)} with Khalti`}
                  variant="secondary"
                  onPress={() => void pay("khalti", "auto", request.id)}
                  loading={busy === "khalti"}
                  disabled={busy !== null}
                  style={{ marginTop: space["2"] }}
                />
              </>
            )}
          </Card>
        ))}
        {captainCanRequest ? (
          <Card style={{ marginTop: space["3"] }}>
            {/* Card lays its children out flush and Field has no bottom margin,
                so without a gap here the "Send payment request" button sat
                against the note box and read as part of it. */}
            <View style={{ gap: space["3"] }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>{advance.active ? "Ask teammates to cover the advance" : balance > 0 ? "Ask a teammate to pay their part" : "Ask a teammate to reimburse you"}</Text>
              <Text style={[styles.meta, { color: colors.textMuted }]}>{advance.active || balance > 0
                ? "Select teammates and enter each contribution. They pay the venue directly; the request and verified payment are saved against this booking."
                : "You covered this booking yourself. Select teammates to ask for their part back — they settle it with you and you record it in the player ledger."}</Text>
              {advance.active ? <Text style={[styles.meta, { color: colors.textMuted }]}>Available to request: {formatNPR(advance.available)} · {formatNPR(advance.pending)} already requested</Text> : null}
              {(booking.teamPlayers ?? []).filter((p) => p.id !== user?.id).length === 0 ? <Text style={[styles.hint, { color: colors.textMuted }]}>No teammates are on this booking's team yet.</Text> : null}
              <View style={styles.playerChoices}>
                {(booking.teamPlayers ?? []).filter((player) => player.id !== user?.id).map((player) => {
                  const selected = requestPayerIds.includes(String(player.id));
                  const pending = advance.active && advance.requests.some((r) => r.payerId === player.id && r.status === "pending");
                  return (
                    <Button
                      key={player.id}
                      label={pending ? `${player.name} · requested` : selected ? `✓ ${player.name}` : player.name}
                      disabled={pending}
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
              <Button label="Send payment request" onPress={() => void requestMoney()} loading={requestBusy} disabled={requestBusy || requestPayerIds.length === 0 || (advance.active && Number(requestAmount) * requestPayerIds.length > advance.available)} />
            </View>
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
                <Text style={[styles.cardTitle, { color: colors.text }]}>Player payment details</Text>
                <Text style={[styles.meta, { color: colors.textMuted }]}>How your friends chose to pay · {formatNPR(teamReceived)} received of {formatNPR(teamDue)}</Text>
              </View>
              <Text style={[styles.expandText, { color: colors.textMuted }]}>{teamDetailsOpen ? "Hide" : "Open"}</Text>
            </Pressable>
            {user ? (
              <Button
                label="Open player ledger (team, open spots & guests)"
                variant="secondary"
                onPress={() => setSquadLedgerOpen(true)}
                style={{ marginTop: space["2"] }}
              />
            ) : null}
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
                        <Text style={[styles.teamPlayerName, { color: colors.text }]}>{player.name}{player.role === "captain" ? " · captain" : ""}{user && player.id === user.id ? " (you)" : ""}</Text>
                        <Text style={[styles.meta, { color: colors.textMuted }]}>Due {formatNPR(due)} · Paid {formatNPR(paid)} · Method: {paymentMethodLabel(share?.paymentMethod)}</Text>
                        {remaining > 0 ? <Text style={[styles.teamRemaining, { color: "#B45309" }]}>Remaining {formatNPR(remaining)}</Text> : null}
                        {pendingFor(player.id).length > 0 ? (
                          <Text style={[styles.hint, { color: colors.textMuted }]}>
                            Asked for {formatNPR(pendingFor(player.id).reduce((sum, request) => sum + request.amountDue, 0))} · {paymentStatusLabel(pendingFor(player.id)[0].status)}
                          </Text>
                        ) : null}
                        {share?.gatewayTxnId ? <Text style={[styles.hint, { color: colors.textFaint }]}>Gateway reference: {share.gatewayTxnId.slice(0, 18)}</Text> : null}
                      </View>
                      <View style={{ gap: space["2"], alignItems: "flex-end" }}>
                        <Pill label={paymentStatusLabel(share?.paymentStatus ?? "not selected")} tone={share?.paymentStatus === "paid" ? "success" : "warning"} />
                        {isBooker && user && player.id !== user.id && pendingFor(player.id).length === 0 ? (
                          <Button
                            label="Ask to pay"
                            variant="secondary"
                            onPress={() => {
                              void askTeammate(player.id, due, paid).then(setSuccess).catch((e) => setError(e instanceof Error ? e.message : "Could not send the request."));
                            }}
                            disabled={requestBusy || (advance.active && advance.available < 10)}
                          />
                        ) : null}
                        {isBooker && pendingFor(player.id).length > 0 ? (
                          <Button label="Cancel request" variant="ghost" onPress={() => void cancelRequest(pendingFor(player.id)[0].id)} disabled={requestBusy} />
                        ) : null}
                      </View>
                    </View>
                  );
                })}
                {(booking.paymentRequests ?? []).length > 0 ? (
                  <View style={{ marginTop: space["3"] }}>
                    <Text style={[styles.subTitle, { color: colors.textMuted }]}>Directed requests</Text>
                    {(booking.paymentRequests ?? []).map((request) => (
                      <View key={request.id} style={[styles.requestDetail, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                        <Text style={[styles.teamPlayerName, { color: colors.text }]}>{request.requesterName} → {request.payerName}: {formatNPR(request.amountDue)}</Text>
                        <Text style={[styles.meta, { color: colors.textMuted }]}>{request.purpose === "advance" ? "Venue advance" : request.purpose === "reimbursement" ? "Reimburse the organizer" : "Team booking"} · {paymentMethodLabel(request.paymentMethod)} · {paymentStatusLabel(request.status)} · Paid {formatNPR(request.paidAmount)}</Text>
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
          {isTeamBooking ? (
            <MoneyRow
              label="Squad shares"
              value={formatNPR(money.received) + " of " + formatNPR(squadDue)}
              colors={colors}
              tone={money.balance === 0 ? "credit" : "due"}
            />
          ) : null}
          <MoneyRow label="Owed" value={formatNPR(totals.owed)} colors={colors} />
          <MoneyRow label="Paid" value={formatNPR(totals.paid)} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <MoneyRow
            label={balance > 0 ? (isTeamBooking ? "Venue balance" : "Balance due") : "Surplus"}
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
            ) : isTeamBooking ? (
              <>
                {/*
                  No share row for this player: the old generic "Pay with eSewa"
                  charged the venue balance, which never settles a player share
                  — the booking then read "Nothing paid yet" after a verified
                  payment. Label what the money actually does.
                */}
                <Button
                  label="Pay venue balance with eSewa"
                  onPress={() => pay("esewa")}
                  loading={busy === "esewa"}
                  disabled={busy !== null}
                />
                <Button
                  label="Pay venue balance with Khalti"
                  variant="secondary"
                  onPress={() => pay("khalti")}
                  loading={busy === "khalti"}
                  disabled={busy !== null}
                  style={{ marginTop: space["2"] }}
                />
                <Text style={[styles.hint, { color: colors.textFaint }]}>
                  This settles the venue's desk, not a player share — your account isn't on this
                  squad's payment list, so the share status will not change.
                </Text>
              </>
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
              advance.active
                ? "The venue advance is still outstanding. Use the advance section above to pay or request teammate contributions."
                : requestedForMe.length > 0
                  ? "You have a payment request above awaiting payment."
                : competitionWaiting
                ? "Waiting for the opposition captain to accept this competition request. Payment opens only after acceptance."
                : booking.status === "cancelled"
                  ? "This booking was cancelled."
                  : booking.status === "rejected"
                    ? "This competition request was declined and was not sent to the venue owner."
                    : teamShare && teamShare.paymentStatus !== "paid"
                      ? "Your share is still outstanding. Choose a payment method from My Bookings."
                      : balance > 0
                        ? `The venue still has ${formatNPR(balance)} to collect. Your team share and the venue balance are tracked separately.`
                        : "The venue has received the full booking amount. Enjoy the game! ⚽"
            }
            tone={advance.active || requestedForMe.length > 0 || balance > 0 ? "info" : competitionWaiting || booking.status === "cancelled" || booking.status === "rejected" ? "error" : "success"}
          />
        )}
      </ScrollView>
      {squadLedgerOpen && user ? (
        <TeamLedgerPanel
          bookingId={bookingId}
          actorId={user.id}
          bookingLabel={booking?.teamName ?? ""}
          onClose={() => setSquadLedgerOpen(false)}
          onChanged={() => void load(true, true)}
          onAsk={(member) => askTeammate(member.userId, member.amountDue, member.collected)}
        />
      ) : null}
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

  meta: { fontSize: fontSize.base, marginTop: 2, marginBottom: space["3"] },
  pillRow: { flexDirection: "row", gap: space["2"], marginBottom: space["2"] },
  paymentLabels: { flexDirection: "row", flexWrap: "wrap", gap: space["2"], marginBottom: space["2"] },
  locationBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space["2"],
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: space["3"],
    paddingVertical: space["2"],
    marginBottom: space["2"],
  },
  locationText: { flexShrink: 1, fontSize: fontSize.sm, fontWeight: "800" },
  locationAction: { fontSize: fontSize.xs, fontWeight: "900" },
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
