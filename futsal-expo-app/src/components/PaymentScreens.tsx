import { useLocalSearchParams, useRouter } from "expo-router";
import { CheckCircle2, CreditCard, Loader2, PartyPopper, ShieldCheck, XCircle } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError } from "@/lib/api";
import { formatNPR } from "@/lib/futsal";
import { leaguePaymentsAction, verifyEsewa, verifyKhalti } from "@/api";
import { appReturnLinks, esewaDataFromLocation, isMobileBrowser } from "@/lib/gateway";
import { canCheckCheckout, canRetryCheckout, checkLastCheckout, retryLastCheckout } from "@/lib/checkout";
import { useTheme } from "@/context/ThemeContext";
import { colors, fontSize, radius, space } from "@/theme";

type Params = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function numberParam(value: string | string[] | undefined): number {
  const n = Number(one(value));
  return Number.isFinite(n) ? n : 0;
}

/** Native versions of the hosted gateway pages used by the web app. */
export function EsewaMockScreen() {
  const params = useLocalSearchParams() as Params;
  const router = useRouter();
  const leagueId = one(params.leagueId);
  const requestId = one(params.paymentRequestId);
  return <GatewayMock kind="esewa" params={params} onDone={(id) => router.replace(leagueId ? `/leagues/${leagueId}?paid=1` : `/payment/esewa/success?mock=1&bookingId=${id}${requestId ? `&paymentRequestId=${requestId}` : ""}`)} onCancel={(id) => router.replace(leagueId ? `/leagues/${leagueId}` : `/payment/esewa/failure?bookingId=${id}`)} />;
}

export function KhaltiMockScreen() {
  const params = useLocalSearchParams() as Params;
  const router = useRouter();
  const leagueId = one(params.leagueId);
  const requestId = one(params.paymentRequestId);
  return <GatewayMock kind="khalti" params={params} onDone={(id) => router.replace(leagueId ? `/leagues/${leagueId}?paid=1` : `/payment/khalti/callback?mock=1&pidx=${encodeURIComponent(one(params.pidx))}&bookingId=${id}${requestId ? `&paymentRequestId=${requestId}` : ""}&status=Completed`)} onCancel={(id) => router.replace(leagueId ? `/leagues/${leagueId}` : `/payment/khalti/callback?bookingId=${id}&status=User%20canceled`)} />;
}

function GatewayMock({ kind, params, onDone, onCancel }: { kind: "esewa" | "khalti"; params: Params; onDone: (bookingId: string) => void; onCancel: (bookingId: string) => void }) {
  const [busy, setBusy] = useState(false);
  // One id per checkout, retained if verification is retried. A subsequent
  // checkout (e.g. the balance after a deposit) must get a different id.
  const [checkoutId] = useState(() => `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [error, setError] = useState("");
  const bookingId = one(params.bookingId);
  const teamPaymentId = one(params.teamPaymentId);
  const paymentRequestId = one(params.paymentRequestId);
  const leagueId = one(params.leagueId);
  const teamId = one(params.teamId);
  const amount = numberParam(params.amount);
  const isLeague = Boolean(leagueId && teamId);
  const purple = kind === "khalti";
  const accent = purple ? "#5C2D91" : "#087443";
  const soft = purple ? "#FAF5FF" : colors.emerald50;
  const label = purple ? "Khalti" : "eSewa";

  async function pay() {
    setBusy(true);
    setError("");
    try {
      if (isLeague) {
        await leaguePaymentsAction(Number(leagueId), {
          action: "verify",
          mockApprove: true,
          userId: numberParam(params.userId),
          teamId: Number(teamId),
          amount,
          method: label,
        });
      } else if (kind === "esewa") {
        await verifyEsewa({
          bookingId: Number(bookingId),
          mockApprove: true,
          teamPaymentId: teamPaymentId ? Number(teamPaymentId) : undefined,
          paymentRequestId: paymentRequestId ? Number(paymentRequestId) : undefined,
          userId: numberParam(params.userId) || undefined,
          uuid: one(params.uuid) || checkoutId,
          paymentPurpose: one(params.paymentPurpose) === "advance" ? "advance" : undefined,
          expectedAmount: amount,
        });
      } else {
        await verifyKhalti({
          bookingId: Number(bookingId),
          pidx: one(params.pidx) && one(params.pidx) !== "mock-pidx" ? one(params.pidx) : checkoutId,
          mockApprove: true,
          teamPaymentId: teamPaymentId ? Number(teamPaymentId) : undefined,
          paymentRequestId: paymentRequestId ? Number(paymentRequestId) : undefined,
          userId: numberParam(params.userId) || undefined,
          paymentPurpose: one(params.paymentPurpose) === "advance" ? "advance" : undefined,
          expectedAmount: amount,
        });
      }
      if (isLeague) {
        // League checkout returns to its detail page, just like the web mock.
        onDone(bookingId);
      } else {
        onDone(bookingId);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Mock payment failed. Nothing was charged.");
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: accent }]} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.gatewayScroll}>
        <View style={styles.gatewayCard}>
          <View style={[styles.gatewayHead, { backgroundColor: accent }]}>
            <Text style={styles.gatewayName}>{label}</Text>
            <Text style={styles.fallbackChip}>Simulator • gateway unreachable</Text>
          </View>
          <View style={styles.gatewayBody}>
            <View style={[styles.amountCard, { backgroundColor: soft }]}>
              <Text style={[styles.amountKicker, { color: accent }]}>Paying to FutsalNepal test store</Text>
              <Text style={[styles.amount, { color: purple ? "#4C1D95" : "#064E3B" }]}>{formatNPR(amount)}</Text>
              <Text style={[styles.reference, { color: accent }]}>{isLeague ? `league #${leagueId} • squad #${teamId}` : `booking #${bookingId}`}</Text>
            </View>
            <View style={styles.testInfo}><Text style={styles.testText}>This is a safe test checkout. No real money moves.</Text><Text style={styles.testText}>The server ledger and payment statuses use the same verified path as production.</Text></View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable onPress={() => void pay()} disabled={busy} style={[styles.payButton, { backgroundColor: accent }]}>
              {busy ? <Loader2 size={18} color="#FFFFFF" /> : <ShieldCheck size={18} color="#FFFFFF" />}
              <Text style={styles.payText}>{busy ? "Processing…" : `Pay ${formatNPR(amount)}`}</Text>
            </Pressable>
            <Pressable onPress={() => onCancel(bookingId)} disabled={busy} style={styles.cancelButton}><XCircle size={17} color={colors.stone500} /><Text style={styles.cancelText}>Cancel payment</Text></Pressable>
            <Text style={styles.disclaimer}>You can return to My Bookings and try again whenever you&apos;re ready.</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The page eSewa sends the browser back to.
 *
 * Two arrivals, one screen:
 *
 *   • the real test server — the URL carries `data`, the base64 blob eSewa
 *     signed. It is posted to the server, which checks the HMAC, confirms the
 *     amount and asks eSewa's status API before anything is marked paid.
 *   • the local simulator — `mock=1` and the mock screen already verified, so
 *     there is nothing left to do but say so.
 */
export function EsewaSuccessScreen() {
  const params = useLocalSearchParams() as Params;
  const router = useRouter();
  const mock = one(params.mock) === "1";
  const [bookingId, setBookingId] = useState(one(params.bookingId));
  const [state, setState] = useState<"loading" | "success" | "failure">(mock ? "success" : "loading");
  const [message, setMessage] = useState("");
  // What the server said it settled — a booking, a teammate's share, a league
  // entry fee. It knows which; this screen does not, so it shows that wording
  // instead of guessing "your booking".
  const [settled, setSettled] = useState("");

  useEffect(() => {
    if (state !== "loading") return;

    const data =
      one(params.data) ||
      esewaDataFromLocation(typeof window !== "undefined" ? window.location.search : "");

    if (!data) {
      setState("failure");
      setMessage("eSewa came back without a payment response. Check My Bookings for the status.");
      return;
    }

    verifyEsewa({
      data,
      bookingId: numberParam(params.bookingId) || undefined,
      teamPaymentId: numberParam(params.teamPaymentId) || undefined,
      paymentRequestId: numberParam(params.paymentRequestId) || undefined,
      userId: numberParam(params.userId) || undefined,
    })
      .then((result) => {
        const booking = (result as { booking?: { id?: number } }).booking;
        if (booking?.id) setBookingId(String(booking.id));
        setSettled(String((result as { message?: string }).message ?? ""));
        setState("success");
      })
      .catch((e) => {
        setState("failure");
        setMessage(e instanceof Error ? e.message : "eSewa could not verify that payment.");
      });
  }, [params, state]);

  const backToApp = useReturnToApp("/payment/esewa/success", params);

  // Settled: take the player back into the app without making them hunt for it.
  useEffect(() => {
    if (state !== "success" || !backToApp.available) return;

    const timer = setTimeout(backToApp.open, 1200);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, backToApp.available]);

  if (state === "loading") return <LoadingResult label="Confirming your eSewa payment… 💚" />;

  return (
    <ResultScreen
      kind={state}
      gateway="eSewa"
      bookingId={bookingId}
      message={
        state === "success"
          ? settled || (mock ? "eSewa test payment confirmed." : "eSewa confirmed the payment and your booking is settled. 🎉")
          : message
      }
      primaryLabel={!bookingId && state === "success" ? "Back to the app" : undefined}
      onPrimary={() => router.replace(bookingId ? "/bookings?refresh=1" : "/leagues")}
      secondaryLabel={backToApp.available ? "Open the app" : undefined}
      onSecondary={backToApp.available ? backToApp.open : () => router.replace("/venues")}
    />
  );
}

export function EsewaFailureScreen() {
  const params = useLocalSearchParams() as Params;
  const router = useRouter();
  const retry = useCheckoutRetry();
  const [settled, setSettled] = useState("");
  const base = "No money moved. Your booking is still waiting — pay from My Bookings whenever you are ready.";

  // eSewa's page can say a payment failed while the money actually moved (their
  // UAT does this). Their status API is the only thing that can tell the two
  // apart, so offer to ask it before the player pays twice.
  async function check() {
    const outcome = await retry.check();
    if (outcome.status === "settled") setSettled(outcome.message);
  }

  if (settled) {
    return (
      <ResultScreen
        kind="success"
        gateway="eSewa"
        bookingId={one(params.bookingId)}
        message={settled}
        onPrimary={() => router.replace("/bookings?refresh=1")}
        onSecondary={() => router.replace("/venues")}
      />
    );
  }

  return (
    <ResultScreen
      kind="failure"
      gateway="eSewa"
      bookingId={one(params.bookingId)}
      message={retry.message || base}
      primaryLabel={retry.retryable ? (retry.busy ? "Opening…" : "Try again") : undefined}
      primaryBusy={retry.busy}
      onPrimary={retry.retryable ? retry.retry : () => router.replace("/bookings?refresh=1")}
      secondaryLabel={retry.checkable ? (retry.checking ? "Asking eSewa…" : "Check with eSewa") : undefined}
      secondaryBusy={retry.checking}
      onSecondary={retry.checkable ? () => void check() : () => router.replace("/venues")}
    />
  );
}

export function KhaltiCallbackScreen() {
  const params = useLocalSearchParams() as Params;
  const router = useRouter();
  const bookingId = one(params.bookingId);
  const teamPaymentId = one(params.teamPaymentId);
  const paymentRequestId = one(params.paymentRequestId);
  const status = one(params.status);
  const [state, setState] = useState<"loading" | "success" | "failure">(
    one(params.mock) === "1" ? "success" : "loading",
  );
  const [message, setMessage] = useState("");
  const retry = useCheckoutRetry();
  const backToApp = useReturnToApp("/payment/khalti/callback", params);

  useEffect(() => {
    if (state !== "success" || !backToApp.available) return;

    const timer = setTimeout(backToApp.open, 1200);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, backToApp.available]);

  useEffect(() => {
    if (state !== "loading") return;
    const pidx = one(params.pidx);
    if (!pidx) {
      setState("failure");
      setMessage("Missing Khalti session. Check My Bookings for status.");
      return;
    }
    verifyKhalti({
      bookingId: Number(bookingId) || undefined,
      pidx,
      mockApprove: false,
      // Khalti returns the order id it was given; it names the team share or
      // player request this session belongs to.
      orderId: one(params.purchase_order_id) || undefined,
      teamPaymentId: teamPaymentId ? Number(teamPaymentId) : undefined,
      paymentRequestId: paymentRequestId ? Number(paymentRequestId) : undefined,
      userId: numberParam(params.userId) || undefined,
    })
      .then(() => setState("success"))
      .catch((e) => {
        setState("failure");
        setMessage(e instanceof Error ? e.message : "Verification failed");
      });
    // `status` is only a hint from Khalti's redirect; the lookup is the truth,
    // so an early "Completed" still goes through verification.
    void status;
  }, [params, state]);

  if (state === "loading") return <LoadingResult label="Verifying Khalti payment… 💜" />;

  return (
    <ResultScreen
      kind={state === "success" ? "success" : "failure"}
      gateway="Khalti"
      bookingId={bookingId}
      message={
        state === "success"
          ? "Khalti test payment confirmed."
          : retry.message || message || "Could not verify the payment."
      }
      primaryLabel={state === "failure" && retry.retryable ? (retry.busy ? "Opening…" : "Try again") : undefined}
      primaryBusy={retry.busy}
      onPrimary={
        state === "failure" && retry.retryable
          ? retry.retry
          : () => router.replace("/bookings?refresh=1")
      }
      secondaryLabel={backToApp.available ? "Open the app" : undefined}
      onSecondary={backToApp.available ? backToApp.open : () => router.replace("/venues")}
    />
  );
}

/**
 * Hand the player back to the app.
 *
 * The gateway needs an http(s) URL, so even on the phone that started the
 * payment the return lands in a browser — on this web build, which verifies the
 * payment and then offers the way back in (`exp://…` in Expo Go, the app's own
 * scheme in a built app). It tries by itself once the payment is settled, since
 * that is what the player wants next, and keeps the button for when the system
 * prompt is dismissed.
 */
function useReturnToApp(path: string, params: Params) {
  const [links, setLinks] = useState<string[]>([]);

  useEffect(() => {
    if (!isMobileBrowser()) return;

    const query = [
      params.bookingId ? `bookingId=${one(params.bookingId)}` : "",
      params.teamPaymentId ? `teamPaymentId=${one(params.teamPaymentId)}` : "",
      params.paymentRequestId ? `paymentRequestId=${one(params.paymentRequestId)}` : "",
      params.userId ? `userId=${one(params.userId)}` : "",
      params.leagueId ? `leagueId=${one(params.leagueId)}` : "",
      params.teamId ? `teamId=${one(params.teamId)}` : "",
    ]
      .filter(Boolean)
      .join("&");

    setLinks(appReturnLinks(query ? `${path}?${query}` : path));
  }, [path, params]);

  function open() {
    const target = links[0];

    if (!target || typeof window === "undefined") return;

    window.location.href = target;
  }

  return { available: links.length > 0, open };
}

/**
 * "Try again" on a failure screen.
 *
 * The gateway hands the browser back to a route that knows nothing about the
 * checkout that started it, so this asks `src/lib/checkout.ts` for the last one
 * and follows wherever it leads: the gateway page again, the simulator route, or
 * straight to the page the fallback settled on.
 */
function useCheckoutRetry() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const retryable = canRetryCheckout();
  const checkable = canCheckCheckout();

  async function retry() {
    setBusy(true);
    setMessage("");

    const outcome = await retryLastCheckout();

    if (outcome.status === "gateway") {
      router.replace("/bookings?refresh=1");
      return;
    }

    if (outcome.status === "simulator") {
      router.replace(outcome.mockPath as never);
      return;
    }

    if (outcome.status === "settled") {
      router.replace(outcome.donePath as never);
      return;
    }

    setBusy(false);
    setMessage(
      outcome.status === "error"
        ? outcome.message
        : "There is nothing to retry here — pay again from My Bookings.",
    );
  }

  /**
   * Ask the gateway about the last checkout, and report what it says. A
   * "settled" answer is the caller's cue to show success — the money moved even
   * though this screen was told it failed.
   */
  async function check() {
    setChecking(true);
    setMessage("");

    const outcome = await checkLastCheckout();

    setChecking(false);

    if (outcome.status === "settled") return outcome;
    if (outcome.status === "open") setMessage(outcome.message);

    return outcome;
  }

  return {
    retry: () => void retry(),
    check,
    busy,
    checking,
    message,
    retryable,
    checkable,
  };
}

function LoadingResult({ label }: { label: string }) {
  const { colors: c } = useTheme();
  return <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["bottom"]}><View style={styles.loading}><Loader2 size={44} color={colors.emerald600} /><Text style={[styles.loadingText, { color: c.text }]}>{label}</Text></View></SafeAreaView>;
}

function ResultScreen({ kind, gateway, bookingId, message, primaryLabel, primaryBusy, secondaryLabel, secondaryBusy, onPrimary, onSecondary }: { kind: "success" | "failure"; gateway: string; bookingId: string; message: string; primaryLabel?: string; primaryBusy?: boolean; secondaryLabel?: string; secondaryBusy?: boolean; onPrimary: () => void; onSecondary: () => void }) {
  const { colors: c } = useTheme();
  const success = kind === "success";
  return <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["bottom"]}><ScrollView contentContainerStyle={styles.resultScroll}><View style={[styles.resultCard, { backgroundColor: c.surface, borderColor: c.border }]}><View style={[styles.resultIcon, { backgroundColor: success ? colors.emerald600 : colors.red500 }]}>{success ? <PartyPopper size={32} color="#FFFFFF" /> : <XCircle size={32} color="#FFFFFF" />}</View><Text style={[styles.resultTitle, { color: c.text }]}>{success ? "Payment verified! 🎉" : `${gateway} payment cancelled 😌`}</Text><Text style={[styles.resultBody, { color: c.textMuted }]}>{message}{bookingId ? ` Booking #FN-${bookingId}.` : ""}</Text><View style={styles.resultActions}><Pressable onPress={onPrimary} style={[styles.resultPrimary, { backgroundColor: colors.emerald600 }]}>{primaryBusy ? <Loader2 size={16} color="#FFFFFF" /> : <CheckCircle2 size={16} color="#FFFFFF" />}<Text style={styles.resultPrimaryText}>{primaryLabel ?? (success ? "Track booking" : "Pay from bookings")}</Text></Pressable><Pressable onPress={onSecondary} disabled={secondaryBusy} style={[styles.resultSecondary, { borderColor: c.border }]}>{secondaryBusy ? <Loader2 size={16} color={c.text} /> : <CreditCard size={16} color={c.text} />}<Text style={[styles.resultSecondaryText, { color: c.text }]}>{secondaryLabel ?? "Browse courts"}</Text></Pressable></View></View></ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gatewayScroll: { flexGrow: 1, justifyContent: "center", padding: space[4] },
  gatewayCard: { width: "100%", maxWidth: 440, alignSelf: "center", overflow: "hidden", borderRadius: 32, backgroundColor: "#FFFFFF", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  gatewayHead: { padding: space[6], alignItems: "center" },
  gatewayName: { color: "#FFFFFF", fontSize: 26, fontWeight: "900", fontStyle: "italic" },
  fallbackChip: { color: "rgba(255,255,255,0.9)", backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5, marginTop: 8, fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  gatewayBody: { padding: space[6], gap: space[3] },
  amountCard: { borderRadius: radius["2xl"], padding: space[4], alignItems: "center" },
  amountKicker: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1, textAlign: "center" },
  amount: { fontSize: 30, fontWeight: "900", marginTop: 4 },
  reference: { fontSize: 11, fontWeight: "700", marginTop: 4 },
  testInfo: { borderWidth: 1, borderStyle: "dashed", borderColor: "#E7E5E4", borderRadius: radius.xl, padding: space[3], gap: 3 },
  testText: { color: colors.stone500, fontSize: fontSize.xs, lineHeight: 17 },
  error: { color: colors.red600, backgroundColor: colors.red50, borderRadius: radius.xl, padding: space[3], fontSize: fontSize.xs, fontWeight: "800" },
  payButton: { minHeight: 50, borderRadius: radius["2xl"], alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space[2] },
  payText: { color: "#FFFFFF", fontSize: fontSize.base, fontWeight: "900" },
  cancelButton: { minHeight: 46, borderWidth: 1, borderColor: "#E7E5E4", borderRadius: radius["2xl"], alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space[2] },
  cancelText: { color: colors.stone500, fontSize: fontSize.base, fontWeight: "800" },
  disclaimer: { color: colors.stone400, fontSize: fontSize.xs, textAlign: "center", lineHeight: 17 },
  resultScroll: { flexGrow: 1, justifyContent: "center", padding: space[4] },
  resultCard: { width: "100%", maxWidth: 440, alignSelf: "center", borderWidth: 1, borderRadius: 32, padding: space[8], alignItems: "center" },
  resultIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  resultTitle: { fontSize: fontSize["2xl"], fontWeight: "900", textAlign: "center", marginTop: space[4] },
  resultBody: { fontSize: fontSize.base, lineHeight: 20, textAlign: "center", marginTop: space[2] },
  resultActions: { width: "100%", gap: space[2], marginTop: space[6] },
  resultPrimary: { minHeight: 48, borderRadius: radius["2xl"], alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space[2] },
  resultPrimaryText: { color: "#FFFFFF", fontSize: fontSize.base, fontWeight: "900" },
  resultSecondary: { minHeight: 48, borderWidth: 1, borderRadius: radius["2xl"], alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space[2] },
  resultSecondaryText: { fontSize: fontSize.base, fontWeight: "900" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[4], padding: space[6] },
  loadingText: { fontSize: fontSize.lg, fontWeight: "900", textAlign: "center" },
});
