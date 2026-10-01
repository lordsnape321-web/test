import {
  chooseBookingPayment,
  chooseBookingPaymentRequest,
  chooseBookingTeamPayment,
  initiateEsewa,
  initiateKhalti,
  initiateLeaguePayment,
  verifyEsewa,
  verifyKhalti,
  type LeaguePaymentInput,
  type PaymentInitiateInput,
} from "@/api";
import { ApiError } from "@/lib/api";
import { formatNPR } from "@/lib/futsal";
import { demoPageUrl, openCheckout, prepareGatewayTab, realGatewayEnabled, releaseGatewayTab } from "@/lib/gateway";
import { demoPayments } from "@/lib/payment-mode";
import { planCheckout, type GatewayInitiate, type GatewayMethod } from "@/lib/gateway-plan";
import { STORAGE_KEYS, storage } from "@/lib/storage";

/**
 * One checkout, from "the player tapped Pay" to "the gateway has the browser".
 *
 * Every payment button in the app runs this: ask the server to build a session
 * for this exact target, then act on its answer — open the gateway, hand back a
 * page to open, or report why neither happened. The screens only own the
 * sentence they show and the route they fall back to.
 *
 * The checkout is also *remembered*, as a serializable record, because paying
 * happens in another app: the player leaves for eSewa or Khalti, and whatever
 * brings them back — the gateway's redirect, a deep link, a notification, or
 * their own thumb — lands on a screen that has no idea a payment was in flight.
 * From the record this module can rebuild everything the return screens need:
 * start it again, run the replica if the gateway is down, ask the gateway
 * whether the money actually moved, and say what the payment was for.
 */

export type CheckoutOutcome =
  /**
   * A checkout page is open (or the tab is navigating to it) — the gateway's
   * own, or the backend's replica of it. `demo` says which.
   */
  | { status: "gateway"; demo?: boolean }
  /** Nothing was charged and nothing opened; `message` is worth showing. */
  | { status: "error"; message: string };

/**
 * Which checkout to run: the gateway's test server, or the demo replica.
 *
 * `demo` is the built-in replica — a checkout that always works, because it
 * does not depend on eSewa's shared wallets or Khalti's sandbox being up. It
 * settles through the *same* server-side verification as a real payment
 * (`mockApprove`), so the ledger, the booking states and the amounts are the
 * real code paths, not a mock of them.
 */
export type CheckoutMode = "real" | "demo";

/** The mode a checkout should use, given an explicit choice or the setting. */
export function checkoutMode(force?: CheckoutMode): CheckoutMode {
  if (force) return force;

  return demoPayments() ? "demo" : "real";
}

/**
 * What is waiting on a gateway, in a form that survives a reload.
 *
 * Deliberately plain data: the same object is handed to the pending card, put
 * in AsyncStorage, and read back after the app restarts.
 */
export type PendingRecord =
  | {
      kind: "booking";
      method: GatewayMethod;
      input: PaymentInitiateInput;
      label: string;
      /** Where to go once the payment is settled. */
      donePath: string;
      /** A real Khalti session id, once one exists — needed to ask about it. */
      pidx?: string;
      /**
       * The replica page this checkout opened, once it has one.
       *
       * A demo payment is finished on its own page — there is nothing at the
       * gateway to ask about — so this is what the pending card offers to
       * reopen, and why a demo record never gets a gateway check.
       */
      demoUrl?: string;
    }
  | {
      kind: "league";
      leagueId: number;
      method: "eSewa" | "Khalti";
      input: LeaguePaymentInput;
      label: string;
      donePath: string;
      demoUrl?: string;
    };

/** A record the return screens can act on. */
export type RememberedCheckout = {
  label: string;
  /** Ask the server for a session, and open it (or report the fallback). */
  run: (force?: CheckoutMode) => Promise<CheckoutOutcome>;
  /** The replica page this checkout opened, when there is one to reopen. */
  demoUrl?: string;
  /**
   * Ask the gateway whether this payment actually happened.
   *
   * A test gateway can show "payment failed" while the money moved — eSewa's
   * own status API is the tiebreaker, and it is the only way to tell a real
   * cancel from a failure their side forgot to record. Resolves with the
   * sentence to show once the payment is settled.
   *
   * Absent for a demo checkout: the replica settles through this app's own
   * verify call, so there is nothing at a gateway to ask about.
   */
  check?: () => Promise<{ settled: boolean; message: string }>;
  /** Where to go once the payment is settled. */
  donePath: string;
};

/** A record older than this is not worth chasing — the session is long gone. */
const PENDING_TTL_MS = 6 * 60 * 60 * 1000;

let lastCheckout: RememberedCheckout | null = null;
let lastRecord: PendingRecord | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/* ------------------------------------------------------------------ store */

/** Remember how to start this checkout again (see `PendingRecord`). */
export function rememberCheckout(record: PendingRecord): void {
  lastRecord = record;
  lastCheckout = attemptFor(record);
  void persist(record);
  announce();
}

/** The checkout waiting on a gateway, if there is one. */
export function pendingCheckout(): RememberedCheckout | null {
  return lastCheckout;
}

/** The plain record behind the pending checkout, for anything that needs it. */
export function pendingRecord(): PendingRecord | null {
  return lastRecord;
}

/** Stop tracking the pending checkout (after it settled, or on dismiss). */
export function clearCheckout(): void {
  lastCheckout = null;
  lastRecord = null;
  void storage.remove(STORAGE_KEYS.pendingCheckout);
  announce();
}

/** Subscribe to pending-checkout changes; returns the unsubscribe. */
export function subscribeCheckout(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Bring back a checkout that outlived the app.
 *
 * `initStorage()` (called once at start-up) has already read the key into
 * memory, so this is synchronous — which matters, because it runs while a
 * screen is rendering and a flash of "no payment pending" would be exactly the
 * thing this feature exists to avoid.
 */
export function restorePendingCheckout(): void {
  if (lastCheckout) return;

  const raw = storage.getCached(STORAGE_KEYS.pendingCheckout);

  if (!raw) return;

  try {
    const saved = JSON.parse(raw) as { at?: number; record?: PendingRecord };

    if (!saved?.record || Date.now() - (saved.at ?? 0) > PENDING_TTL_MS) {
      void storage.remove(STORAGE_KEYS.pendingCheckout);
      return;
    }

    lastRecord = saved.record;
    lastCheckout = attemptFor(saved.record);
    announce();
  } catch {
    void storage.remove(STORAGE_KEYS.pendingCheckout);
  }
}

async function persist(record: PendingRecord): Promise<void> {
  await storage.set(STORAGE_KEYS.pendingCheckout, JSON.stringify({ at: Date.now(), record }));
}

/**
 * Note the page a demo checkout opened, so the pending card can reopen it.
 *
 * Only the replica needs this: a real gateway is asked about through its own
 * API (`check`), while a demo is finished on its page and nowhere else.
 */
function rememberDemoUrl(url: string): void {
  if (!lastRecord) return;

  lastRecord = { ...lastRecord, demoUrl: url };
  void persist(lastRecord);
  announce();
}

/**
 * Note the gateway's session id once `initiate` returns one.
 *
 * Only Khalti needs it: its return URL carries a `pidx`, but a player who never
 * makes it back to that URL can still be asked about — with this. A `mock-…`
 * id is not stored, because it is not a gateway session.
 */
function rememberPidx(pidx: string): void {
  if (!lastRecord || lastRecord.kind !== "booking" || lastRecord.method !== "khalti") return;
  if (pidx.startsWith("mock-")) return;

  lastRecord = { ...lastRecord, pidx };
  void persist(lastRecord);
}

/* ------------------------------------------------------------- rebuilding */

/** Turn a stored record back into something the screens can act on. */
function attemptFor(record: PendingRecord): RememberedCheckout {
  if (record.kind === "league") {
    const input = record.input;

    return {
      label: record.label,
      run: (force) => startLeagueCheckout(record.leagueId, record.method, input, force),
      donePath: record.donePath,
      demoUrl: record.demoUrl,
    };
  }

  const input = record.input;

  return {
    label: record.label,
    run: (force) => startGatewayCheckout(record.method, input, force),
    donePath: record.donePath,
    demoUrl: record.demoUrl,
    // A demo checkout has no gateway session to ask about, so it offers no
    // check at all rather than one that answers "no completed payment" about a
    // payment the app itself settled.
    check: record.demoUrl ? undefined : checkFor(record),
  };
}

/**
 * How to ask about a booking payment — or nothing, when there is nothing to ask.
 *
 * eSewa is asked through the same verify endpoint the return page uses, which
 * falls back to its status API when no signed payload came back. Khalti can only
 * be asked with the session id it issued, so a checkout that never got that far
 * offers no check button.
 */
function checkFor(record: Extract<PendingRecord, { kind: "booking" }>): (() => Promise<{ settled: boolean; message: string }>) | undefined {
  const input = record.input;

  if (record.method === "esewa") {
    return async () => {
      try {
        await verifyEsewa({
          bookingId: input.bookingId,
          userId: input.userId,
          teamPaymentId: input.teamPaymentId,
          paymentRequestId: input.paymentRequestId,
          paymentPurpose: input.paymentPurpose,
        });

        return { settled: true, message: "eSewa confirms this payment was completed. Your booking is settled. 🎉" };
      } catch (e) {
        return { settled: false, message: describeCheck(e, input) };
      }
    };
  }

  if (!record.pidx) return undefined;

  const pidx = record.pidx;

  return async () => {
    try {
      await verifyKhalti({ bookingId: input.bookingId, pidx, userId: input.userId, teamPaymentId: input.teamPaymentId });

      return { settled: true, message: "Khalti confirms this payment was completed. Your booking is settled. 🎉" };
    } catch (e) {
      return {
        settled: false,
        message: e instanceof Error ? e.message : "Khalti did not report a completed payment for this booking.",
      };
    }
  };
}

/**
 * What the gateway said, in a sentence a payer can act on.
 *
 * The server's message carries eSewa's own verdict ("eSewa says: FAILED —
 * nothing has been settled yet") and its body names the amount and the
 * transaction it asked about. Those three facts are what turn "it failed" into
 * something worth showing: they say it was the debit, not the login, and they
 * are the first thing to check against the wallet.
 */
function describeCheck(e: unknown, input: PaymentInitiateInput): string {
  const base = e instanceof Error ? e.message : "eSewa did not report a completed payment for this booking.";

  if (!(e instanceof ApiError)) return base;

  const info = (e.body as {
    esewa?: { status?: string; amount_asked?: number; transaction_uuid?: string };
  } | undefined)?.esewa;

  if (!info) return base;

  const bits: string[] = [];

  if (typeof info.amount_asked === "number" && info.amount_asked > 0) {
    bits.push(`asked for ${formatNPR(info.amount_asked)}`);
  }
  if (info.transaction_uuid) bits.push(`txn ${info.transaction_uuid}`);
  // The server's sentence already names the status in the usual case; only
  // repeat it when it does not (NOT_FOUND, or a status we did not expect).
  if (info.status && String(info.status) !== "UNKNOWN" && !base.toUpperCase().includes(String(info.status).toUpperCase())) {
    bits.push(`eSewa status ${info.status}`);
  }
  if (input.bookingId) bits.push(`booking #${input.bookingId}`);

  return bits.length > 0 ? `${base} (${bits.join(" · ")})` : base;
}

/**
 * True when this session has a checkout a failure screen can offer to retry.
 */
export function canRetryCheckout(): boolean {
  return lastCheckout !== null;
}

/** True when the gateway itself can be asked about the last checkout. */
export function canCheckCheckout(): boolean {
  return lastCheckout?.check !== undefined;
}

/** True when the pending checkout can be re-pointed at the other gateway. */
export function canSwitchCheckout(): boolean {
  return lastRecord !== null;
}

/** True when the pending checkout is the given gateway already. */
export function pendingGateway(): GatewayMethod | null {
  return lastRecord ? (lastRecord.method === "eSewa" ? "esewa" : lastRecord.method === "Khalti" ? "khalti" : lastRecord.method) : null;
}

/* --------------------------------------------------------------- starting */

/**
 * Start a checkout. Call `prepareGatewayTab()` in the tap handler before this
 * (see its note): the tab has to be reserved while the tap is still live.
 */
export function startGatewayCheckout(
  method: GatewayMethod,
  input: PaymentInitiateInput,
  force?: CheckoutMode,
): Promise<CheckoutOutcome> {
  // The server builds the session differently for the replica (it returns the
  // demo route directly instead of calling the gateway), so the choice is sent
  // with the request rather than applied to its answer.
  const payload = { ...input, demo: checkoutMode(force) === "demo" };

  return runCheckout(method, () => (method === "esewa" ? initiateEsewa(payload) : initiateKhalti(payload)));
}

/**
 * The same checkout for a league entry fee.
 *
 * `method` is the app's own label — the panel speaks in "eSewa"/"Khalti" — and
 * `input` is the squad and the amount. Everything after the initiate call is
 * identical to a booking payment, because the server's answer is identical.
 */
export function startLeagueCheckout(
  leagueId: number,
  method: "eSewa" | "Khalti",
  input: LeaguePaymentInput,
  force?: CheckoutMode,
): Promise<CheckoutOutcome> {
  return runCheckout(method === "eSewa" ? "esewa" : "khalti", () =>
    initiateLeaguePayment(leagueId, { ...input, method, demo: checkoutMode(force) === "demo" }),
  );
}

async function runCheckout(method: GatewayMethod, load: () => Promise<GatewayInitiate>): Promise<CheckoutOutcome> {
  try {
    const initiate = await load();

    if (initiate?.pidx && initiate.mock !== true) rememberPidx(String(initiate.pidx));

    const plan = planCheckout(method, initiate);

    if (plan.kind === "gateway" || plan.kind === "form") {
      if (plan.demo && plan.kind === "gateway") rememberDemoUrl(plan.url);
      if (openCheckout(plan)) return { status: "gateway", demo: plan.demo === true };
    }

    /*
     * The server answered the demo checkout without a page of its own — an
     * older backend. Its mock URL names this app's own route, which is not what
     * a page is opened from, but it carries every parameter the replica page
     * needs; `demoPageUrl` moves them onto the page that does exist.
     */
    if (plan.kind === "simulator") {
      const url = demoPageUrl(method, plan.url, initiate?.amount);

      if (url !== "" && openCheckout({ kind: "gateway", url, demo: true, amount: initiate?.amount })) {
        rememberDemoUrl(url);

        return { status: "gateway", demo: true };
      }

      releaseGatewayTab();

      return {
        status: "error",
        message: plan.message ?? "The checkout page could not be opened — check the connection and try again.",
      };
    }

    releaseGatewayTab();

    return {
      status: "error",
      message: plan.kind === "error" ? plan.message : "Could not open the payment page.",
    };
  } catch (e) {
    // Could not start a checkout at all: the API refused (a played game, an
    // already-paid share), or the network blinked. Say so — a silent fallback
    // would hide a refusal that matters.
    releaseGatewayTab();

    return {
      status: "error",
      message: e instanceof Error && e.message
        ? e.message
        : "Could not start the payment — check the connection and try again.",
    };
  }
}

/* ----------------------------------------------------------------- retry */

export type CheckOutcome =
  | { status: "settled"; message: string; donePath: string }
  | { status: "open"; message: string }
  | { status: "unavailable" };

/** Ask the gateway about the session's last checkout (see `check`). */
export async function checkLastCheckout(): Promise<CheckOutcome> {
  const attempt = lastCheckout;

  if (!attempt?.check) return { status: "unavailable" };

  try {
    const result = await attempt.check();

    if (result.settled) {
      // Settled: nothing left to chase, so stop showing the pending card.
      clearCheckout();

      return { status: "settled", message: result.message, donePath: attempt.donePath };
    }

    return { status: "open", message: result.message };
  } catch (e) {
    return {
      status: "open",
      message: e instanceof Error ? e.message : "Could not check that payment with the gateway.",
    };
  }
}

export type RetryOutcome =
  /** A checkout page is open again (the gateway's, or the replica). */
  | { status: "gateway"; demo?: boolean }
  /** This session never ran a checkout. */
  | { status: "nothing" }
  | { status: "error"; message: string };

/**
 * Re-run the session's last checkout, from a failure screen.
 *
 * `force` exists because a failure is often the moment to change your mind: the
 * same payment can be retried on the real test server (`"real"`), or run on the
 * built-in replica (`"demo"`) when the gateway is the thing that is broken.
 */
export async function retryLastCheckout(force?: CheckoutMode): Promise<RetryOutcome> {
  const attempt = lastCheckout;

  if (!attempt) return { status: "nothing" };

  prepareGatewayTab();

  return finishAttempt(attempt, await attempt.run(checkoutMode(force)));
}

/**
 * Pay the same thing with the other gateway.
 *
 * The two test servers are independent: eSewa refusing a debit says nothing
 * about Khalti, and a payer who was refused should not have to go back to the
 * booking, find the card, and pick a different button to try the other one.
 * So the pending checkout is re-pointed at `method` and started again.
 *
 * Both gateways refuse a target that is marked for the other one, so the
 * choice is saved first — the same call the app makes when a player picks a
 * gateway from a booking card. A switched checkout also drops the old session
 * id and mock path: they name a session the other gateway never issued.
 */
export async function switchLastCheckoutGateway(method: GatewayMethod): Promise<RetryOutcome> {
  const record = lastRecord;

  if (!record) return { status: "nothing" };

  const label = method === "esewa" ? "eSewa" : "Khalti";

  if (record.kind === "booking" && record.input.userId) {
    const { bookingId, userId, teamPaymentId, paymentRequestId } = record.input;

    try {
      if (teamPaymentId) {
        await chooseBookingTeamPayment(bookingId, userId, label);
      } else if (paymentRequestId) {
        await chooseBookingPaymentRequest(bookingId, paymentRequestId, userId, label);
      } else {
        await chooseBookingPayment(bookingId, userId, label);
      }
    } catch (e) {
      return {
        status: "error",
        message: e instanceof Error ? e.message : `Could not move this payment to ${label}.`,
      };
    }
  }

  // The old session's id and page belong to the other gateway — both are
  // dropped, and the new checkout sets its own.
  const next: PendingRecord = record.kind === "booking"
    ? { ...record, method, pidx: undefined, demoUrl: undefined, label: relabel(record.label, label) }
    : { ...record, method: label as "eSewa" | "Khalti", demoUrl: undefined };

  rememberCheckout(next);
  prepareGatewayTab();

  const attempt = attemptFor(next);

  return finishAttempt(attempt, await attempt.run(checkoutMode("real")));
}

/** "eSewa · booking #12" → "Khalti · booking #12" (and the other way round). */
function relabel(label: string, method: "eSewa" | "Khalti"): string {
  return /^(eSewa|Khalti)\b/.test(label)
    ? label.replace(/^(eSewa|Khalti)\b/, method)
    : `${method} · ${label}`;
}

/** Turn a started checkout into the sentence (or route) a screen acts on. */
async function finishAttempt(
  attempt: RememberedCheckout,
  outcome: CheckoutOutcome,
): Promise<RetryOutcome> {
  void attempt;

  if (outcome.status === "gateway") return { status: "gateway", demo: outcome.demo };

  releaseGatewayTab();

  return { status: "error", message: outcome.message };
}

export { prepareGatewayTab, realGatewayEnabled, releaseGatewayTab } from "@/lib/gateway";
