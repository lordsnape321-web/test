import {
  initiateEsewa,
  initiateKhalti,
  initiateLeaguePayment,
  leaguePaymentsAction,
  verifyEsewa,
  verifyKhalti,
  type LeaguePaymentInput,
  type PaymentInitiateInput,
} from "@/api";
import { openCheckout, prepareGatewayTab, realGatewayEnabled, releaseGatewayTab } from "@/lib/gateway";
import { planCheckout, type GatewayInitiate, type GatewayMethod } from "@/lib/gateway-plan";
import { STORAGE_KEYS, storage } from "@/lib/storage";

/**
 * One checkout, from "the player tapped Pay" to "the gateway has the browser".
 *
 * Every payment button in the app runs this: ask the server to build a session
 * for this exact target, then act on its answer — open the gateway, hand back a
 * simulator route, or report why neither happened. The screens only own the
 * sentence they show and the route they fall back to.
 *
 * The checkout is also *remembered*, as a serializable record, because paying
 * happens in another app: the player leaves for eSewa or Khalti, and whatever
 * brings them back — the gateway's redirect, a deep link, a notification, or
 * their own thumb — lands on a screen that has no idea a payment was in flight.
 * From the record this module can rebuild everything the return screens need:
 * start it again, run the simulator if the gateway is down, ask the gateway
 * whether the money actually moved, and say what the payment was for.
 */

export type CheckoutOutcome =
  /** The gateway page is open (or the tab is navigating to it). */
  | { status: "gateway" }
  /** The server could not reach the gateway — run the local simulator route. */
  | { status: "simulator" }
  /** Nothing was charged and nothing opened; `message` is worth showing. */
  | { status: "error"; message: string };

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
      /** Where the simulator runs if the gateway cannot be reached. */
      mockPath: string;
      /** Where to go once the payment is settled. */
      donePath: string;
      /** A real Khalti session id, once one exists — needed to ask about it. */
      pidx?: string;
    }
  | {
      kind: "league";
      leagueId: number;
      method: "eSewa" | "Khalti";
      input: LeaguePaymentInput;
      label: string;
      donePath: string;
    };

/** A record the return screens can act on. */
export type RememberedCheckout = {
  label: string;
  /** Ask the server for a session, and open it (or report the fallback). */
  run: () => Promise<CheckoutOutcome>;
  /** Where the simulator runs when the gateway cannot be reached. */
  mockPath?: string;
  /**
   * For a league entry fee, whose simulator runs in place instead of on its own
   * route: the settle call itself. Returns the sentence to show.
   */
  settle?: () => Promise<string>;
  /**
   * Ask the gateway whether this payment actually happened.
   *
   * A test gateway can show "payment failed" while the money moved — eSewa's
   * own status API is the tiebreaker, and it is the only way to tell a real
   * cancel from a failure their side forgot to record. Resolves with the
   * sentence to show once the payment is settled.
   */
  check?: () => Promise<{ settled: boolean; message: string }>;
  /** Where to go once the fallback has settled the payment. */
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
 * Note the gateway's session id once `initiate` returns one.
 *
 * Only Khalti needs it: its return URL carries a `pidx`, but a player who never
 * makes it back to that URL can still be asked about — with this. The simulator's
 * `mock-…` id is not stored, because it is not a gateway session.
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
      run: () => startLeagueCheckout(record.leagueId, record.method, input),
      donePath: record.donePath,
      settle: async () => {
        const data = await leaguePaymentsAction(record.leagueId, {
          action: "verify",
          mockApprove: true,
          userId: input.userId,
          teamId: input.teamId,
          amount: input.amount,
          method: record.method,
        });

        return String(data.message ?? "Payment recorded ✅");
      },
    };
  }

  const input = record.input;

  return {
    label: record.label,
    run: () => startGatewayCheckout(record.method, input),
    mockPath: record.mockPath,
    donePath: record.donePath,
    check: checkFor(record),
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
        return {
          settled: false,
          message: e instanceof Error ? e.message : "eSewa did not report a completed payment for this booking.",
        };
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
 * True when this session has a checkout a failure screen can offer to retry.
 */
export function canRetryCheckout(): boolean {
  return lastCheckout !== null;
}

/** True when the gateway itself can be asked about the last checkout. */
export function canCheckCheckout(): boolean {
  return lastCheckout?.check !== undefined;
}

/* --------------------------------------------------------------- starting */

/**
 * Start a checkout. Call `prepareGatewayTab()` in the tap handler before this
 * (see its note): the tab has to be reserved while the tap is still live.
 */
export function startGatewayCheckout(
  method: GatewayMethod,
  input: PaymentInitiateInput,
): Promise<CheckoutOutcome> {
  return runCheckout(method, () => (method === "esewa" ? initiateEsewa(input) : initiateKhalti(input)));
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
): Promise<CheckoutOutcome> {
  return runCheckout(method === "eSewa" ? "esewa" : "khalti", () =>
    initiateLeaguePayment(leagueId, { ...input, method }),
  );
}

async function runCheckout(method: GatewayMethod, load: () => Promise<GatewayInitiate>): Promise<CheckoutOutcome> {
  try {
    const initiate = await load();

    if (initiate?.pidx && initiate.mock !== true) rememberPidx(String(initiate.pidx));

    const plan = planCheckout(method, initiate);

    if (plan.kind === "gateway" || plan.kind === "form") {
      if (openCheckout(plan)) return { status: "gateway" };
    }

    if (plan.kind === "simulator") return { status: "simulator" };

    releaseGatewayTab();

    return {
      status: "error",
      message: plan.kind === "error" ? plan.message : "Could not open the payment page.",
    };
  } catch {
    // Could not start a real session (the API refused, or the network blinked).
    // The simulator re-runs the very same server-side checks, so a payment that
    // must not happen still fails there — with the server's own wording — while
    // a checkout that only failed to reach a gateway still completes.
    releaseGatewayTab();

    return { status: "simulator" };
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
  /** The gateway page is open again. */
  | { status: "gateway" }
  /** The gateway could not be reached — run the simulator route. */
  | { status: "simulator"; mockPath: string }
  /** The fallback settled it right here (a league entry fee). */
  | { status: "settled"; donePath: string; message: string }
  /** This session never ran a checkout. */
  | { status: "nothing" }
  | { status: "error"; message: string };

/** Re-run the session's last checkout, from a failure screen. */
export async function retryLastCheckout(): Promise<RetryOutcome> {
  const attempt = lastCheckout;

  if (!attempt) return { status: "nothing" };

  prepareGatewayTab();

  const outcome = realGatewayEnabled()
    ? await attempt.run()
    : ({ status: "simulator" } as CheckoutOutcome);

  if (outcome.status === "gateway") return { status: "gateway" };

  if (outcome.status === "simulator") {
    if (attempt.mockPath) return { status: "simulator", mockPath: attempt.mockPath };

    if (attempt.settle) {
      try {
        return { status: "settled", donePath: attempt.donePath, message: await attempt.settle() };
      } catch (e) {
        releaseGatewayTab();

        return { status: "error", message: e instanceof Error ? e.message : "That payment could not be recorded." };
      }
    }

    releaseGatewayTab();

    return { status: "error", message: "Could not start that payment again." };
  }

  releaseGatewayTab();

  return { status: "error", message: outcome.message };
}

export { prepareGatewayTab, realGatewayEnabled, releaseGatewayTab } from "@/lib/gateway";
