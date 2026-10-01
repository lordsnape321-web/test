import {
  initiateEsewa,
  initiateKhalti,
  initiateLeaguePayment,
  type LeaguePaymentInput,
  type PaymentInitiateInput,
} from "@/api";
import { openCheckout, prepareGatewayTab, realGatewayEnabled, releaseGatewayTab } from "@/lib/gateway";
import { planCheckout, type GatewayInitiate, type GatewayMethod } from "@/lib/gateway-plan";

/**
 * One checkout, from "the player tapped Pay" to "the gateway has the browser".
 *
 * Every payment button in the app runs this: ask the server to build a session
 * for this exact target, then act on its answer — open the gateway, hand back a
 * simulator route, or report why neither happened. The screens only own the
 * sentence they show and the route they fall back to.
 */

export type CheckoutOutcome =
  /** The gateway page is open (or the tab is navigating to it). */
  | { status: "gateway" }
  /** The server could not reach the gateway — run the local simulator route. */
  | { status: "simulator" }
  /** Nothing was charged and nothing opened; `message` is worth showing. */
  | { status: "error"; message: string };

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

/* ------------------------------------------------------------------ retry */

/**
 * The checkout a "Try again" press should re-run.
 *
 * A test gateway can hand the browser back without a payment — eSewa's own
 * wording for that is "Service is currently unavailable. Please try again
 * later." — and a cancelled Khalti session lands on the same return screen. That
 * screen is a different route from the booking that started it, so it cannot
 * know what to restart. One module-level slot remembers the last checkout of the
 * session: how to start it again, where the simulator lives if the gateway still
 * cannot be reached, and where to go once the fallback has settled it.
 */
export type RememberedCheckout = {
  /** Ask the server for a session, and open it (or report the fallback). */
  run: () => Promise<CheckoutOutcome>;
  /** Where the simulator runs when the gateway cannot be reached. */
  mockPath?: string;
  /**
   * For a league entry fee, whose simulator runs in place instead of on its own
   * route: the settle call itself. Returns the sentence to show.
   */
  settle?: () => Promise<string>;
  /** Where to go once the fallback has settled the payment. */
  donePath: string;
};

let lastCheckout: RememberedCheckout | null = null;

/** Remember how to start this checkout again (see `RememberedCheckout`). */
export function rememberCheckout(attempt: RememberedCheckout): void {
  lastCheckout = attempt;
}

/** True when this session has a checkout a failure screen can offer to retry. */
export function canRetryCheckout(): boolean {
  return lastCheckout !== null;
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
