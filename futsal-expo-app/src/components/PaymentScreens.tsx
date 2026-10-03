import { useLocalSearchParams, useRouter } from "expo-router";
import { CheckCircle2, CreditCard, Loader2, PartyPopper, ShieldCheck, XCircle } from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError } from "@/lib/api";
import { formatNPR } from "@/lib/futsal";
import { leaguePaymentsAction, verifyEsewa, verifyKhalti } from "@/api";
import {
  appReturnLinks,
  esewaDataFromLocation,
  isMobileBrowser,
  type GatewayMethod,
} from "@/lib/gateway";
import {
  canCheckCheckout,
  canRetryCheckout,
  canSwitchCheckout,
  checkLastCheckout,
  clearCheckout,
  pendingGateway,
  pendingRecord,
  retryLastCheckout,
  switchLastCheckoutGateway,
  type CheckoutMode,
} from "@/lib/checkout";
import { TextControl } from "@/components/ui";
import { useTheme } from "@/context/ThemeContext";
import { colors, fontSize, radius, space } from "@/theme";

type Params = Record<string, string | string[] | undefined>;

/**
 * What a refused eSewa debit is, and what to do about it.
 *
 * eSewa reports FAILED whenever its own test wallet could not cover the amount
 * — their test users are shared, and "adequate balance" is a promise, not a
 * standing balance — and also when a test login has sat for more than about
 * five minutes. Neither is the app's error, and both are worth saying out loud
 * instead of leaving the payer to guess.
 */
const ESEWA_REFUSED_HINT =
  "eSewa reports FAILED when its shared test wallet can't cover the amount, or when the login session sat for more than five minutes. Worth trying: a smaller payment, another test wallet (…1112 to …1114), or pay with Khalti instead.";

/** Where the other gateway's test payer comes from. */
const KHALTI_HINT = "Khalti's test payer: 9800000001 · MPIN 1111 · OTP 987654.";

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function numberParam(value: string | string[] | undefined): number {
  const n = Number(one(value));
  return Number.isFinite(n) ? n : 0;
}

/**
 * The demo checkout: eSewa's and Khalti's pages, run inside the app.
 *
 * These are the screens the Pay buttons open in demo mode — the same checkout
 * this app has always run for a demo, with the flow the real test server has:
 *
 *   1. sign in (eSewa ID + password; Khalti mobile number),
 *   2. confirm with the 4-digit MPIN,
 *   3. the 6-digit verification token / OTP,
 *   4. the confirmation screen — the wallet's balance, the amount, what is left
 *      after paying, and the button that pays.
 *
 * The credentials are the published test logins, so a rehearsal here uses the
 * values that work on the real servers, and a wrong value is refused with the
 * value to use instead. The balance is the replica's own — a demo wallet is
 * never short — and the ledger behind it is real: finishing posts `mockApprove`
 * to the same verify endpoint a real payment uses, so bookings, shares, league
 * entries, notifications and receipts are the real code paths.
 *
 * A page does the same job for a browser (`laravel/public/demo-*.html`, served
 * at `/api/payments/{gateway}/demo`); the app uses the screens, because a
 * checkout that never leaves the app cannot lose the payer on the way back.
 */

/** What the replica's wallet holds. Never less than the payment: a demo is not
 *  where anyone should meet "insufficient balance". */
const DEMO_BALANCE = { esewa: 25000, khalti: 18500 } as const;

const DEMO_LOGINS = {
  esewa: {
    ids: ["9711111111", "9711111112", "9711111113", "9711111114", "9806800001", "9806800002", "9806800003", "9806800004", "9806800005"],
    id: "9711111111",
    password: "Test@123",
    pin: "1122",
    token: "123456",
    steps: [
      { title: "Sign in to eSewa", sub: "Your eSewa ID and password.", cta: "Log in" },
      { title: "Confirm with MPIN", sub: "The 4-digit MPIN of your eSewa wallet.", cta: "Continue" },
      { title: "Verification token", sub: "The 6-digit token eSewa sent to your phone.", cta: "Continue" },
    ],
  },
  khalti: {
    ids: ["9800000000", "9800000001", "9800000002", "9800000003", "9800000004", "9800000005"],
    id: "9800000001",
    password: "",
    pin: "1111",
    token: "987654",
    steps: [
      { title: "Sign in to Khalti", sub: "Your Khalti mobile number.", cta: "Log in" },
      { title: "Confirm with MPIN", sub: "The 4-digit MPIN of your Khalti account.", cta: "Continue" },
      { title: "OTP verification", sub: "The 6-digit code Khalti sent you.", cta: "Continue" },
    ],
  },
} as const;

export function EsewaMockScreen() {
  const params = useLocalSearchParams() as Params;
  const router = useRouter();
  const leagueId = one(params.leagueId);
  const requestId = one(params.paymentRequestId);

  return (
    <GatewayMock
      kind="esewa"
      params={params}
      onDone={(id) =>
        router.replace(
          (leagueId
            ? `/leagues/${leagueId}?paid=1`
            : `/payment/esewa/success?mock=1&bookingId=${id}${requestId ? `&paymentRequestId=${requestId}` : ""}`) as never,
        )
      }
      onCancel={(id) => router.replace((leagueId ? `/leagues/${leagueId}` : `/payment/esewa/failure?bookingId=${id}`) as never)}
    />
  );
}

export function KhaltiMockScreen() {
  const params = useLocalSearchParams() as Params;
  const router = useRouter();
  const leagueId = one(params.leagueId);
  const requestId = one(params.paymentRequestId);

  return (
    <GatewayMock
      kind="khalti"
      params={params}
      onDone={(id) =>
        router.replace(
          (leagueId
            ? `/leagues/${leagueId}?paid=1`
            : `/payment/khalti/callback?mock=1&pidx=${encodeURIComponent(one(params.pidx))}&bookingId=${id}${
                requestId ? `&paymentRequestId=${requestId}` : ""
              }&status=Completed`) as never,
        )
      }
      onCancel={(id) => router.replace((leagueId ? `/leagues/${leagueId}` : `/payment/khalti/callback?bookingId=${id}&status=User%20canceled`) as never)}
    />
  );
}

function GatewayMock({
  kind,
  params,
  onDone,
  onCancel,
}: {
  kind: "esewa" | "khalti";
  params: Params;
  onDone: (bookingId: string) => void;
  onCancel: (bookingId: string) => void;
}) {
  const retry = useCheckoutRetry();
  const [busy, setBusy] = useState(false);
  // One id per checkout, retained if verification is retried. A subsequent
  // checkout (e.g. the balance after a deposit) must get a different id.
  const [checkoutId] = useState(() => `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [token, setToken] = useState("");
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
  const login = DEMO_LOGINS[kind];
  const steps = login.steps;
  // The confirmation screen is the fourth step; the three above are the login.
  const confirmStep = steps.length;
  const balance = Math.max(DEMO_BALANCE[kind], amount + 500);
  // `demo=1` means the replica was chosen; without it the gateway was down and
  // this is the fallback, which the header says out loud.
  const chosen = one(params.demo) === "1";
  const fallbackReason = one(params.fallback);

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

      onDone(bookingId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That demo payment could not be recorded. Nothing was charged.");
      setBusy(false);
    }
  }

  /** Fill every step at once, and land on the confirmation screen. */
  function fillDemo() {
    setId(login.id);
    setPassword(login.password);
    setPin(login.pin);
    setToken(login.token);
    setError("");
    setStep(confirmStep);
  }

  /**
   * Move to the next step, or pay on the last one.
   *
   * Each step checks its own value against the published test credentials — the
   * replica is a rehearsal for the real thing, so the values that work there are
   * the values that work here.
   */
  function advance() {
    const wrong =
      step === 0
        ? !(login.ids as readonly string[]).includes(id.trim())
          ? `Use a demo ${label} ID — ${login.id} works, and the other test wallets do too.`
          : kind === "esewa" && password !== login.password
            ? `Wrong password. The eSewa demo password is ${login.password}.`
            : ""
        : step === 1
          ? pin !== login.pin
            ? `Wrong MPIN. The ${label} demo MPIN is ${login.pin}.`
            : ""
          : step === 2
            ? token !== login.token
              ? `Wrong token. The ${label} demo ${purple ? "OTP" : "token"} is ${login.token}.`
              : ""
            : "";

    if (wrong) {
      setError(wrong);
      return;
    }

    setError("");

    if (step < confirmStep) {
      setStep(step + 1);
      return;
    }

    void pay();
  }

  const stepDef = steps[Math.min(step, steps.length - 1)];
  const paying = step === confirmStep;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: accent }]} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.gatewayScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.gatewayCard}>
          <View style={[styles.gatewayHead, { backgroundColor: accent }]}>
            <Text style={styles.gatewayName}>{label}</Text>
            <Text style={styles.fallbackChip}>
              {chosen ? `Demo checkout • replica of ${label}` : `Fallback checkout • ${fallbackReason || "gateway unreachable"}`}
            </Text>
          </View>
          <View style={styles.gatewayBody}>
            <View style={[styles.amountCard, { backgroundColor: soft }]}>
              <Text style={[styles.amountKicker, { color: accent }]}>Paying to Futsal Mate test store</Text>
              <Text style={[styles.amount, { color: purple ? "#4C1D95" : "#064E3B" }]}>{formatNPR(amount)}</Text>
              <Text style={[styles.reference, { color: accent }]}>
                {isLeague ? `league #${leagueId} • squad #${teamId}` : `booking #${bookingId}`}
              </Text>
            </View>

            <View style={styles.stepHead}>
              <Text style={[styles.stepTitle, { color: accent }]}>
                {paying ? "Confirm your payment" : stepDef.title}
              </Text>
              <Text style={styles.stepCount}>
                Step {step + 1} of {confirmStep + 1}
              </Text>
            </View>
            <Text style={styles.testText}>
              {paying ? `Check the details, then pay with your ${label} wallet.` : stepDef.sub}
            </Text>

            {step === 0 ? (
              <>
                <TextControl
                  value={id}
                  onChangeText={setId}
                  placeholder={purple ? "98XXXXXXXX" : "9711111111"}
                  keyboardType="number-pad"
                  accessibilityLabel={`${label} ID`}
                />
                {!purple ? (
                  <TextControl
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Password"
                    secureTextEntry
                    accessibilityLabel="eSewa password"
                  />
                ) : null}
              </>
            ) : null}

            {step === 1 ? (
              <TextControl
                value={pin}
                onChangeText={setPin}
                placeholder="MPIN"
                secureTextEntry
                keyboardType="number-pad"
                maxLength={4}
                accessibilityLabel="MPIN"
              />
            ) : null}

            {step === 2 ? (
              <TextControl
                value={token}
                onChangeText={setToken}
                placeholder={purple ? "OTP" : "Token"}
                keyboardType="number-pad"
                maxLength={6}
                accessibilityLabel={purple ? "OTP" : "Token"}
              />
            ) : null}

            {paying ? (
              <View style={[styles.confirmCard, { borderColor: accent }]}>
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmKey}>Merchant</Text>
                  <Text style={styles.confirmValue}>Futsal Mate test store</Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmKey}>{label} balance (demo)</Text>
                  <Text style={styles.confirmValue}>{formatNPR(balance)}</Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={[styles.confirmKey, { color: accent }]}>Amount to pay</Text>
                  <Text style={[styles.confirmValue, { color: accent, fontWeight: "700" }]}>{formatNPR(amount)}</Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmKey}>Balance after payment</Text>
                  <Text style={styles.confirmValue}>{formatNPR(balance - amount)}</Text>
                </View>
                <Text style={styles.confirmNote}>
                  {label} wallet {login.id} — a replica, and the ledger behind it is real. No money moves.
                </Text>
              </View>
            ) : null}

            <View style={styles.testInfo}>
              <Text style={styles.testText}>
                Demo credentials: {login.id}
                {login.password ? ` / ${login.password}` : ""} · MPIN {login.pin} · {purple ? "OTP" : "token"} {login.token}
              </Text>
              <Text style={styles.testText}>A replica of the real page, and the ledger is real — no money moves.</Text>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable onPress={advance} disabled={busy} style={[styles.payButton, { backgroundColor: accent }]}>
              {busy ? <Loader2 size={18} color="#FFFFFF" /> : <ShieldCheck size={18} color="#FFFFFF" />}
              <Text style={styles.payText}>
                {busy ? "Processing…" : paying ? `Pay ${formatNPR(amount)}` : stepDef.cta}
              </Text>
            </Pressable>

            <Pressable onPress={fillDemo} disabled={busy} style={[styles.cancelButton, { borderColor: accent }]}>
              <Text style={[styles.cancelText, { color: accent }]}>Fill demo credentials</Text>
            </Pressable>

            {step > 0 ? (
              <Pressable
                onPress={() => {
                  setStep(step - 1);
                  setError("");
                }}
                disabled={busy}
              >
                <Text style={styles.stepBack}>Back a step</Text>
              </Pressable>
            ) : null}

            <Pressable onPress={() => onCancel(bookingId)} disabled={busy} style={styles.cancelButton}>
              <XCircle size={17} color={colors.stone500} />
              <Text style={styles.cancelText}>Cancel payment</Text>
            </Pressable>

            {chosen && retry.retryable ? (
              <Pressable onPress={() => void retry.retryOn("real")} disabled={retry.busy}>
                <Text style={[styles.stepBack, { color: accent }]}>
                  {retry.busy ? "Opening…" : `Use the real ${label} test server instead`}
                </Text>
              </Pressable>
            ) : null}

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
 *   • the demo checkout — `mock=1`, and the replica page already posted to
 *     `verify` on the way here, so there is nothing left to do but say so.
 */
export function EsewaSuccessScreen() {
  const params = useLocalSearchParams() as Params;
  const router = useRouter();
  const mock = one(params.mock) === "1";

  // Settled. The demo checkout verified before it sent the payer here, so there
  // is nothing left to chase — and leaving the record behind is what made a
  // settled payment still show "Payment in progress" and then answer "eSewa has
  // no completed payment" about a session eSewa was never part of.
  useEffect(() => {
    if (mock) clearCheckout();
  }, [mock]);
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
  const autoChecked = useRef(false);
  const base = "No money moved. Your booking is still waiting — pay from My Bookings whenever you are ready.";
  // The failure URL carries no query of its own (eSewa appends what it likes),
  // so the checkout this session started is what says which booking it was.
  const pending = pendingRecord();
  const bookingId = one(params.bookingId) ||
    (pending?.kind === "booking" ? String(pending.input.bookingId) : "");
  // Only offer the other gateway when the money in flight is with this one.
  const canSwitch = retry.switchable && retry.gateway !== "esewa";

  // eSewa's page can say a payment failed while the money actually moved (their
  // UAT does this). Their status API is the only thing that can tell the two
  // apart, so ask it — on arrival, not behind a button the payer may not press.
  async function check() {
    const outcome = await retry.check();
    if (outcome.status === "settled") setSettled(outcome.message);
  }

  useEffect(() => {
    if (autoChecked.current || !retry.checkable) return;

    autoChecked.current = true;
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry.checkable]);

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
      bookingId={bookingId}
      message={retry.message || base}
      hint={ESEWA_REFUSED_HINT}
      primaryLabel={retry.retryable ? (retry.busy ? "Opening…" : "Try again") : undefined}
      primaryBusy={retry.busy}
      onPrimary={retry.retryable ? retry.retry : () => router.replace("/bookings?refresh=1")}
      secondaryLabel={
        canSwitch
          ? retry.switching
            ? "Opening Khalti…"
            : "Pay with Khalti instead"
          : retry.checkable
            ? retry.checking
              ? "Asking eSewa…"
              : "Check with eSewa"
            : undefined
      }
      secondaryBusy={canSwitch ? retry.switching : retry.checking}
      onSecondary={
        canSwitch
          ? () => void retry.switchTo("khalti")
          : retry.checkable
            ? () => void check()
            : () => router.replace("/venues")
      }
      links={[
        ...(retry.checkable
          ? [{ label: retry.checking ? "Asking eSewa…" : "Check with eSewa again", onPress: () => void check() }]
          : []),
        // The replica is the one checkout that always finishes, and it settles
        // through the same server path — so a refusal here is never a dead end.
        ...(retry.retryable
          ? [{ label: "Use the demo checkout", onPress: () => void retry.retryOn("demo") }]
          : []),
      ]}
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
  // A cancel is not a failed verification: Khalti's page (and the replica's)
  // says so in the status, and asking for a session that never existed would
  // only produce a confusing "missing session" line.
  const cancelled = /cancel/i.test(one(params.status));
  const [state, setState] = useState<"loading" | "success" | "failure">(
    one(params.mock) === "1" ? "success" : cancelled ? "failure" : "loading",
  );
  const [message, setMessage] = useState(
    cancelled ? "You cancelled the Khalti checkout. No money moved." : "",
  );
  const retry = useCheckoutRetry();
  const backToApp = useReturnToApp("/payment/khalti/callback", params);

  // The demo checkout settled through this app's own verify call, so there is
  // nothing left for the pending card to ask Khalti about.
  useEffect(() => {
    if (one(params.mock) === "1") clearCheckout();
  }, [params.mock]);

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

  const failed = state === "failure";
  // A Khalti test checkout can fail on its own terms (a sandbox that is not
  // answering, a session that expired) — eSewa is a working second opinion, and
  // the pending record is what knows how to reach it.
  const canSwitch = failed && retry.switchable && retry.gateway !== "khalti";

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
      hint={failed ? (canSwitch ? KHALTI_HINT : undefined) : undefined}
      primaryLabel={state === "failure" && retry.retryable ? (retry.busy ? "Opening…" : "Try again") : undefined}
      primaryBusy={retry.busy}
      onPrimary={
        state === "failure" && retry.retryable
          ? retry.retry
          : () => router.replace("/bookings?refresh=1")
      }
      secondaryLabel={
        canSwitch
          ? retry.switching
            ? "Opening eSewa…"
            : "Pay with eSewa instead"
          : backToApp.available
            ? "Open the app"
            : undefined
      }
      secondaryBusy={canSwitch ? retry.switching : false}
      onSecondary={
        canSwitch
          ? () => void retry.switchTo("esewa")
          : backToApp.available
            ? backToApp.open
            : () => router.replace("/venues")
      }
      links={
        failed && retry.retryable
          ? [{ label: "Use the demo checkout", onPress: () => void retry.retryOn("demo") }]
          : []
      }
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
 * and follows wherever it leads: the gateway page, the replica page, or
 * straight to the page the fallback settled on.
 */
function useCheckoutRetry() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [message, setMessage] = useState("");
  const retryable = canRetryCheckout();
  const checkable = canCheckCheckout();
  const switchable = canSwitchCheckout();
  const gateway = pendingGateway();

  /**
   * Run the pending checkout again — on the real test server, or on the demo
   * replica (`"demo"`), which is the one answer that always works.
   */
  async function retryOn(mode?: CheckoutMode) {
    setBusy(true);
    setMessage("");

    const outcome = await retryLastCheckout(mode);

    // A checkout page is open (the gateway's, or the replica's), or the replica
    // screen is (the demo checkout, which this pushes) — either way the payer
    // is on a checkout and the app comes back when it is done.
    if (outcome.status === "gateway") {
      setBusy(false);
      return;
    }

    if (outcome.status === "demo") {
      setBusy(false);
      router.replace(outcome.path as never);
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

  /**
   * Pay the same thing with the other gateway, from the screen that refused
   * this one. The record is re-pointed at `method` and started again, so the
   * payer does not have to go back to the booking and find a different button.
   */
  async function switchTo(method: GatewayMethod) {
    setSwitching(true);
    setMessage("");

    const outcome = await switchLastCheckoutGateway(method);

    if (outcome.status === "gateway") {
      setSwitching(false);
      return;
    }

    if (outcome.status === "demo") {
      setSwitching(false);
      router.replace(outcome.path as never);
      return;
    }

    setSwitching(false);
    setMessage(
      outcome.status === "error"
        ? outcome.message
        : "Could not start that payment with the other gateway.",
    );
  }

  return {
    retry: () => void retryOn(),
    retryOn,
    check,
    switchTo,
    busy,
    checking,
    switching,
    message,
    retryable,
    checkable,
    switchable,
    gateway,
  };
}

function LoadingResult({ label }: { label: string }) {
  const { colors: c } = useTheme();
  return <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["bottom"]}><View style={styles.loading}><Loader2 size={44} color={colors.emerald600} /><Text style={[styles.loadingText, { color: c.text }]}>{label}</Text></View></SafeAreaView>;
}

function ResultScreen({ kind, gateway, bookingId, message, hint, primaryLabel, primaryBusy, secondaryLabel, secondaryBusy, onPrimary, onSecondary, links = [] }: { kind: "success" | "failure"; gateway: string; bookingId: string; message: string; hint?: string; primaryLabel?: string; primaryBusy?: boolean; secondaryLabel?: string; secondaryBusy?: boolean; onPrimary: () => void; onSecondary: () => void; links?: { label: string; onPress: () => void }[] }) {
  const { colors: c } = useTheme();
  const success = kind === "success";
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: c.bg }]} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.resultScroll}>
        <View style={[styles.resultCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={[styles.resultIcon, { backgroundColor: success ? colors.emerald600 : colors.red500 }]}>
            {success ? <PartyPopper size={32} color="#FFFFFF" /> : <XCircle size={32} color="#FFFFFF" />}
          </View>
          <Text style={[styles.resultTitle, { color: c.text }]}>
            {success ? "Payment verified! 🎉" : `${gateway} payment didn’t go through 😌`}
          </Text>
          <Text style={[styles.resultBody, { color: c.textMuted }]}>
            {message}
            {bookingId ? ` Booking #FN-${bookingId}.` : ""}
          </Text>
          {hint ? <Text style={[styles.resultHint, { color: c.textMuted }]}>{hint}</Text> : null}
          <View style={styles.resultActions}>
            <Pressable onPress={onPrimary} style={[styles.resultPrimary, { backgroundColor: colors.emerald600 }]}>
              {primaryBusy ? <Loader2 size={16} color="#FFFFFF" /> : <CheckCircle2 size={16} color="#FFFFFF" />}
              <Text style={styles.resultPrimaryText}>{primaryLabel ?? (success ? "Track booking" : "Pay from bookings")}</Text>
            </Pressable>
            <Pressable onPress={onSecondary} disabled={secondaryBusy} style={[styles.resultSecondary, { borderColor: c.border }]}>
              {secondaryBusy ? <Loader2 size={16} color={c.text} /> : <CreditCard size={16} color={c.text} />}
              <Text style={[styles.resultSecondaryText, { color: c.text }]}>{secondaryLabel ?? "Browse courts"}</Text>
            </Pressable>
          </View>
          {links.map((link) => (
            <Pressable key={link.label} onPress={link.onPress} hitSlop={8}>
              <Text style={[styles.resultLink, { color: colors.emerald600 }]}>{link.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
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
  stepHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space[2], marginTop: space[2] },
  stepTitle: { fontSize: fontSize.base, fontWeight: "900" },
  stepCount: { color: colors.stone400, fontSize: fontSize.xs, fontWeight: "800" },
  confirmCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: space[1],
    paddingHorizontal: space[3],
    marginTop: space[3],
  },
  confirmRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space[2],
  },
  confirmKey: { fontSize: fontSize.sm, color: colors.stone500, fontWeight: "600" },
  confirmValue: { fontSize: fontSize.base, color: "#1C1917", fontWeight: "600" },
  confirmNote: { fontSize: fontSize.xs, color: colors.stone500, lineHeight: 16, paddingBottom: space[2] },
  stepBack: { color: colors.stone500, fontSize: fontSize.xs, fontWeight: "800", textAlign: "center", marginTop: space[1] },
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
  resultHint: { fontSize: fontSize.xs, lineHeight: 17, textAlign: "center", marginTop: space[3] },
  resultLink: { fontSize: fontSize.xs, fontWeight: "800", textAlign: "center", marginTop: space[3] },
  resultActions: { width: "100%", gap: space[2], marginTop: space[6] },
  resultPrimary: { minHeight: 48, borderRadius: radius["2xl"], alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space[2] },
  resultPrimaryText: { color: "#FFFFFF", fontSize: fontSize.base, fontWeight: "900" },
  resultSecondary: { minHeight: 48, borderWidth: 1, borderRadius: radius["2xl"], alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space[2] },
  resultSecondaryText: { fontSize: fontSize.base, fontWeight: "900" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[4], padding: space[6] },
  loadingText: { fontSize: fontSize.lg, fontWeight: "900", textAlign: "center" },
});
