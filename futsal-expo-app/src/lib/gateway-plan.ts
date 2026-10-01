import { apiUrl } from "@/lib/api";

/**
 * The decisions behind a checkout, with nothing platform-shaped in them.
 *
 * Kept apart from `src/lib/gateway.ts` on purpose: this file must stay free of
 * `react-native` imports so the logic can be bundled and tested in Node (the
 * same split as `location.ts` / `open-location.ts`).
 *
 * eSewa and Khalti are both hosted checkout pages — the player leaves the app,
 * pays on the gateway's own (test) server, and comes back. The server owns the
 * rules; this file decides what to do with its answer.
 *
 * What the server says (POST /api/payments/{esewa,khalti}/initiate):
 *
 *   • eSewa — `handoffPath`, a page the app opens so the browser can POST the
 *     signed form (a browser can; `Linking.openURL` can only GET). `mockUrl`
 *     is the local simulator, and `fields`/`url` are the raw form if some other
 *     client wants to build it itself.
 *   • Khalti — `payment_url`, the test-pay page, already carrying the session.
 *
 * Both carry `mock: true` when the gateway could not be reached; the checkout
 * then runs against the simulator instead of failing.
 */

export type GatewayMethod = "esewa" | "khalti";

/** The subset of an initiate response this module cares about. */
export type GatewayInitiate = {
  mock?: boolean;
  fallback?: boolean;
  fallbackError?: string;
  testHint?: string;
  /** eSewa */
  url?: string;
  fields?: Record<string, string>;
  handoffPath?: string;
  /** Khalti */
  payment_url?: string;
  pidx?: string;
  /** Both */
  mockUrl?: string;
  amount?: number;
};

export type CheckoutPlan =
  /** `amount` is what the payer is about to be charged — carried so the sheet
   *  can show it next to the gateway's own page. */
  | { kind: "gateway"; url: string; amount?: number }
  /** Legacy API shape: eSewa fields to POST from this browser. */
  | { kind: "form"; url: string; fields: Record<string, string>; amount?: number }
  | { kind: "simulator"; url: string }
  | { kind: "error"; message: string };

/**
 * Decide what a checkout should do, without touching the browser or the OS.
 *
 * Kept pure so the decision can be tested: the side effects live in
 * `prepareGatewayTab` / `openCheckout`, and this only reads the server's answer.
 */
export function planCheckout(method: GatewayMethod, init: GatewayInitiate): CheckoutPlan {
  if (init.mock === true) {
    return init.mockUrl
      ? { kind: "simulator", url: init.mockUrl }
      : { kind: "error", message: init.testHint ?? "The gateway is unavailable right now." };
  }

  if (method === "esewa") {
    /*
     * The signed fields come first, always: a WebView (and a browser page) can
     * POST them directly. `handoffPath` exists for the one surface that cannot
     * — a native app's system browser, which can only open GETs — so it is the
     * fallback rather than the default.
     */
    if (init.url && init.fields && Object.keys(init.fields).length > 0) {
      return { kind: "form", url: init.url, fields: init.fields, amount: init.amount };
    }

    if (init.handoffPath) {
      return { kind: "gateway", url: apiUrl(init.handoffPath), amount: init.amount };
    }

    return { kind: "error", message: "eSewa did not return a checkout form." };
  }

  if (init.payment_url) {
    return { kind: "gateway", url: init.payment_url, amount: init.amount };
  }

  return { kind: "error", message: "Khalti did not return a payment page." };
}

/**
 * eSewa's `data` payload, read straight off the address bar.
 *
 * The route already hands it over as a param, but eSewa appends its own query
 * to the URL we gave it, and a URL that is already carrying one can come back
 * as `?bookingId=5?data=…` — which no query parser wants to split. This is the
 * safety net: if the parser missed it, the raw string still has it.
 */
export function esewaDataFromLocation(search: string): string {
  const match = /[?&]data=([^&]+)/.exec(search ?? "");

  return match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "";
}
