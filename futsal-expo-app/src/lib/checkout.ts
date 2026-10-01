import { initiateEsewa, initiateKhalti, type PaymentInitiateInput } from "@/api";
import { openCheckout, prepareGatewayTab, releaseGatewayTab } from "@/lib/gateway";
import { planCheckout, type GatewayMethod } from "@/lib/gateway-plan";

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
export async function startGatewayCheckout(
  method: GatewayMethod,
  input: PaymentInitiateInput,
): Promise<CheckoutOutcome> {
  try {
    const initiate = method === "esewa" ? await initiateEsewa(input) : await initiateKhalti(input);
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

export { prepareGatewayTab, realGatewayEnabled, releaseGatewayTab } from "@/lib/gateway";
