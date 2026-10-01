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
 *     signed form (a browser can; `Linking.openURL` can only GET), and
 *     `fields`/`url` are the raw form if some other client wants to build it.
 *   • Khalti — `payment_url`, the test-pay page, already carrying the session.
 *
 * Both also carry `demoUrl`, the replica of the gateway's page
 * (`laravel/public/demo-*.html`): the checkout to run when the caller asked for
 * the demo, and the way out when `mock: true` says the gateway could not be
 * reached. An older backend answers `mock: true` with a URL for this app's own
 * mock route instead; that is what the `simulator` plan below is — a page that
 * has to be moved onto the replica before it can be opened.
 */

export type GatewayMethod = "esewa" | "khalti";

/** The subset of an initiate response this module cares about. */
export type GatewayInitiate = {
  mock?: boolean;
  fallback?: boolean;
  /** True when the replica was asked for, not fallen back to. */
  demo?: boolean;
  fallbackError?: string;
  testHint?: string;
  /** eSewa */
  url?: string;
  fields?: Record<string, string>;
  handoffPath?: string;
  /** Khalti */
  payment_url?: string;
  pidx?: string;
  /** The replica page, when the server is answering with the demo checkout. */
  demoUrl?: string;
  /** Both */
  mockUrl?: string;
  amount?: number;
};

export type CheckoutPlan =
  /**
   * A page to open: the gateway's, or the backend's replica of it. `amount` is
   * what the payer is about to be charged — carried so the sheet can show it
   * next to the page. `demo` says which of the two this is.
   */
  | { kind: "gateway"; url: string; amount?: number; demo?: boolean }
  /** Legacy API shape: eSewa fields to POST from this browser. */
  | { kind: "form"; url: string; fields: Record<string, string>; amount?: number; demo?: boolean }
  | { kind: "simulator"; url: string; message?: string }
  | { kind: "error"; message: string };

/**
 * Decide what a checkout should do, without touching the browser or the OS.
 *
 * Kept pure so the decision can be tested: the side effects live in
 * `prepareGatewayTab` / `openCheckout`, and this only reads the server's answer.
 */
export function planCheckout(method: GatewayMethod, init: GatewayInitiate): CheckoutPlan {
  if (init.mock === true) {
    /*
     * The demo checkout is a *page*, served by the backend, and it opens in the
     * in-app sheet exactly like a gateway page — same interception, same return
     * route, same verify endpoint. That is the whole point of it being a
     * website: nothing downstream needs to know the gateway was a replica.
     *
     * The one exception is a server that answers without `demoUrl` (an older
     * backend, or the web app's own mock route): that is a route inside this
     * app, so it keeps the old name and `openCheckout` below refuses it.
     */
    // Khalti answers a fallback with `payment_url` rather than a `mockUrl`;
    // both name the same thing, so both are read here.
    const mockPath = init.mockUrl ?? init.payment_url;
    const demo = init.demoUrl ?? (/^https?:/i.test(mockPath ?? "") ? mockPath : "");

    if (demo) return { kind: "gateway", url: demo, demo: true, amount: init.amount };

    if (mockPath) return { kind: "simulator", url: mockPath, message: init.testHint };

    return { kind: "error", message: init.testHint ?? "The gateway is unavailable right now." };
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
