import Constants from "expo-constants";
import { Linking as RNLinking, Platform } from "react-native";
import { apiUrl } from "@/lib/api";
import { formatNPR } from "@/lib/futsal";
import type { CheckoutPlan, GatewayMethod } from "@/lib/gateway-plan";
import { openInAppGateway } from "@/lib/inapp-gateway";
import { demoPayments } from "@/lib/payment-mode";

/**
 * The platform half of the checkout bridge: opening tabs, navigating to a
 * gateway, and knowing where the app lives. The decisions live next door in
 * `gateway-plan.ts`, which stays free of `react-native` imports.
 */

export type { CheckoutPlan, GatewayInitiate, GatewayMethod } from "@/lib/gateway-plan";
export { esewaDataFromLocation, planCheckout } from "@/lib/gateway-plan";

/**
 * The Expo dev server this build was loaded from, as an http(s) origin.
 *
 * Expo Go and dev-client builds know the machine that served them. That machine
 * serves the *web* build of this same app on the same port, and the app's return
 * screens live there — so a phone that finishes an eSewa checkout in its browser
 * lands on a page that can verify the payment (Metro proxies its `/api` calls
 * back to Laravel).
 */
function devServerOrigin(): string {
  const host = (Constants.expoConfig?.hostUri ?? "").trim();

  if (!host) return "";

  // A tunnel (and anything on :443) is https; a LAN dev server is plain http.
  const scheme = host.endsWith(":443") || host.endsWith(".exp.direct") ? "https" : "http";

  return `${scheme}://${host}`;
}

/**
 * Where the gateway should send the browser when it is done.
 *
 * On the web this is simply the page's own origin — the app is served by Expo,
 * not by the API, and the two are different hosts even locally. A device has no
 * origin of its own: it uses `EXPO_PUBLIC_APP_ORIGIN` when the build sets one,
 * and otherwise the dev server it came from. If even that is unknown — a
 * production build — the app sends nothing and the server falls back to the web
 * origin the deployment configured (`APP_WEB_URL`), which is where the return
 * screens are anyway.
 */
export function paymentReturnOrigin(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }

  const explicit = (process.env.EXPO_PUBLIC_APP_ORIGIN ?? "").trim();

  if (explicit !== "") return explicit.replace(/\/+$/, "");

  return devServerOrigin();
}

/**
 * The http(s) origin of this app's *web* build.
 *
 * Both gateways want an `http`/`https` URL to redirect to — a custom scheme is
 * a risk they need not accept — so the return always points at the web build,
 * which serves the same screens and can verify the payment itself. On a phone
 * that URL is the dev server the app was loaded from (`192.168.x.x:8081`), whose
 * Metro proxies `/api` back to Laravel; on the web it is simply this page.
 */
export function paymentWebOrigin(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }

  const explicit = (process.env.EXPO_PUBLIC_APP_ORIGIN ?? "").trim();

  if (explicit !== "") return explicit.replace(/\/+$/, "");

  const host = (Constants.expoConfig?.hostUri ?? "").trim();

  return host ? `http://${host}` : "";
}

/**
 * The full URL a gateway should send the payer back to for `path`.
 *
 * Query-free on purpose: both gateways append their own parameters, and a URL
 * that already carries a query is a coin flip between `&` and a second `?`.
 */
export function paymentReturnUrl(path: string): string {
  const origin = paymentWebOrigin();

  if (origin !== "") return `${origin}${path}`;

  // Nothing to point at (a production build with no web origin configured):
  // the server falls back to APP_URL / APP_WEB_URL.
  return "";
}

/**
 * Ways back into the app itself, best first.
 *
 * The return page runs in a browser, even on the phone that started the
 * payment — the gateways need an http(s) URL. This is how that page hands the
 * player back to the app: the deep link this build answers to. Expo Go listens
 * on `exp://<dev server>/--/…`, an installed build on the scheme in app.json.
 */
export function appReturnLinks(path: string): string[] {
  const links: string[] = [];
  const host = (Constants.expoConfig?.hostUri ?? "").trim();

  if (host && !host.startsWith("localhost") && !host.startsWith("127.")) {
    links.push(`exp://${host}/--${path}`);
  }

  const configured = Constants.expoConfig?.scheme;
  const scheme = (Array.isArray(configured) ? configured[0] ?? "" : configured ?? "").trim();

  if (scheme && !scheme.includes("://")) {
    links.push(`${scheme}://${path.replace(/^\//, "")}`);
  }

  return links;
}

/** True on a phone/tablet browser, where handing back to the app makes sense. */
export function isMobileBrowser(): boolean {
  if (Platform.OS !== "web") return false;
  if (typeof navigator === "undefined") return false;

  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent ?? "");
}

/**
 * True when a checkout should talk to the providers' own test servers.
 *
 * The replica is the default — a demo cannot depend on eSewa's shared wallets
 * being funded or on Khalti's sandbox being willing to talk — so this is the
 * opt-in side of the one setting, read at checkout time
 * (`src/lib/payment-mode.ts`): *Settings → Use the real eSewa and Khalti test
 * servers*, or `EXPO_PUBLIC_PAYMENT_MODE=real` for a build. Nothing here is
 * platform-specific: a phone and a browser make the same choice.
 */
export function realGatewayEnabled(): boolean {
  return !demoPayments();
}

/** True when the app is running inside someone else's page (the Arena preview). */
export function isFramed(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;

  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin parent: reading `top` is what throws, which means we are framed.
    return true;
  }
}

/* ------------------------------------------------------------------ tabs */

let reservedTab: Window | null = null;

/**
 * Hold a browser tab open for the gateway.
 *
 * Call this synchronously in the button handler, before the `await` that asks
 * the server to start a checkout: browsers only allow a scripted `window.open`
 * during the gesture that triggered it, and a payment page that arrives after an
 * API call is too late. Only used when the app is framed — a `target="_blank"`
 * navigation is the reliable way out of the Arena preview's iframe, while a
 * top-level page is simply replaced.
 */
export function prepareGatewayTab(): void {
  if (Platform.OS !== "web" || typeof window === "undefined" || !isFramed()) return;

  releaseGatewayTab();

  try {
    const tab = window.open("about:blank", "futsal-gateway");

    if (tab) {
      // The gateway page has no reason to reach back into the app.
      try {
        tab.opener = null;
      } catch {
        // Some browsers refuse to let a page give up its opener; harmless.
      }
      reservedTab = tab;
    }
  } catch {
    reservedTab = null;
  }
}

/** Give back a tab that was reserved but never used (the checkout failed). */
export function releaseGatewayTab(): void {
  if (reservedTab && !reservedTab.closed) {
    try {
      reservedTab.close();
    } catch {
      // Already navigating somewhere; leave it.
    }
  }

  reservedTab = null;
}

/** Send the player to a gateway URL, in whatever surface this platform has. */
export function openGatewayUrl(url: string): boolean {
  if (Platform.OS !== "web") {
    void RNLinking.openURL(url).catch(() => undefined);
    return true;
  }

  if (typeof window === "undefined") return false;

  // A same-origin path is resolved against this page before it is handed to a
  // tab — a reserved tab is `about:blank` and should not have to work it out.
  const target = url.startsWith("/") ? new URL(url, window.location.href).href : url;

  if (reservedTab && !reservedTab.closed) {
    reservedTab.location.href = target;
    reservedTab = null;
    return true;
  }

  if (isFramed()) {
    const tab = window.open(target, "_blank");
    if (tab) return true;
    // A blocked popup still leaves same-tab navigation, which at least works.
  }

  window.location.assign(target);
  return true;
}

/**
 * Reopen a demo checkout that was left unfinished.
 *
 * The pending card's job: a payer who closed the sheet before finishing has a
 * page to go back to, and on a phone that means the in-app sheet rather than a
 * browser tab. Nothing is re-initiated — the page carries its own session.
 */
export function reopenDemoCheckout(url: string, label: string): boolean {
  const method = url.includes("khalti") ? "khalti" : "esewa";

  if (Platform.OS === "web") return openGatewayUrl(url);

  const origin = paymentWebOrigin();

  openInAppGateway({
    method,
    demo: true,
    url,
    returnPrefixes: origin === "" ? [] : [`${origin}/payment/`, `${origin}/leagues/`],
    label,
    note: `Replica of the ${method === "esewa" ? "eSewa" : "Khalti"} page — nothing leaves this app, and no real money moves.`,
  });

  return true;
}

/**
 * The label the last remembered checkout gave itself.
 *
 * Read from `src/lib/checkout.ts` lazily to keep this module free of a cycle —
 * checkout imports gateway, so gateway cannot import checkout at module scope.
 */
function lastCheckoutLabel(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const checkout = require("@/lib/checkout") as { pendingCheckout?: () => { label?: string } | null };

    return checkout.pendingCheckout?.()?.label ?? "your payment";
  } catch {
    return "your payment";
  }
}

/** Build and submit eSewa's signed form from the page itself (browser only). */
function postEsewaForm(url: string, fields: Record<string, string>): boolean {
  if (Platform.OS !== "web" || typeof document === "undefined") return false;

  try {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = url;
    form.acceptCharset = "UTF-8";
    form.style.display = "none";

    for (const [name, value] of Object.entries(fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }

    document.body.appendChild(form);

    // Inside the preview iframe the form has to take over the tab, or eSewa's
    // own frame-blocking would render an empty box.
    form.target = isFramed() ? "_top" : "_self";
    form.submit();

    return true;
  } catch {
    return false;
  }
}

/**
 * The replica page for a checkout, assembled here.
 *
 * A fallback for a backend that answers the demo checkout without a `demoUrl`
 * of its own. The page is static (`/demo-esewa.html`, `/demo-khalti.html`) and
 * the server's mock URL already carries every parameter it needs — the app
 * route inside that URL is simply not what a page is opened from.
 *
 * The return URLs are what make it usable: on a phone the sheet intercepts
 * them, and on the web they are this app's own screens. Both are built here
 * because only the client knows which origin it is served from.
 */
export function demoPageUrl(method: GatewayMethod, mockUrl: string, amount?: number): string {
  const [, query = ""] = mockUrl.split("?");
  const params = new URLSearchParams(query);
  const origin = paymentWebOrigin();

  if (origin === "") return "";

  // A league entry fee returns to its own page, exactly like the in-app
  // simulator did; a booking returns to the screen that verifies it.
  const leagueId = params.get("leagueId") ?? "";
  const success = leagueId ? `${origin}/leagues/${leagueId}` : paymentReturnUrl(method === "esewa" ? "/payment/esewa/success" : "/payment/khalti/callback");
  const failure = leagueId
    ? success
    : paymentReturnUrl(method === "esewa" ? "/payment/esewa/failure" : "/payment/khalti/callback");

  params.set("success", success);
  params.set("failure", failure);

  if (amount && !params.has("amount")) params.set("amount", String(amount));

  const url = apiUrl(`/demo-${method === "esewa" ? "esewa" : "khalti"}.html?${params.toString()}`);

  // On the web build the API is same-origin (`/api`), so this is a path, not a
  // page this app serves. There is nothing to open then — the server's own
  // `demoUrl` is the only way to reach the replica from a browser.
  return /^https?:/i.test(url) ? url : "";
}

/**
 * Run a plan. Returns false when the caller should fall back to the simulator.
 *
 * On a phone the gateway page opens *inside* the app (see `GatewaySheet`): the
 * same signed form, posted in a WebView, with the return URL intercepted before
 * it loads. Leaving the app for a browser would hide the app, and — in Expo Go —
 * the deep link back is a prompt the player can dismiss, which is exactly how a
 * finished payment gets lost.
 */
export function openCheckout(plan: CheckoutPlan): boolean {
  if (Platform.OS !== "web") {
    if (plan.kind === "gateway" || plan.kind === "form") {
      const origin = paymentWebOrigin();

      const method = plan.url.includes("khalti") ? "khalti" : "esewa";
      const demo = plan.demo === true;

      openInAppGateway({
        method,
        demo,
        url: plan.url,
        fields: plan.kind === "form" ? plan.fields : undefined,
        // The return screens, at the origin this app's web build is served
        // from. The first one the WebView tries to load ends the checkout —
        // `/payment/…` for a booking, the league's own page for an entry fee.
        returnPrefixes: origin === "" ? [] : [`${origin}/payment/`, `${origin}/leagues/`],
        label: lastCheckoutLabel(),
        // The amount is on the header so the payer can compare it with what the
        // page asks for *before* paying: a mismatch wearing a gateway's branding
        // is exactly the thing nobody questions.
        detail: plan.amount ? formatNPR(plan.amount) : undefined,
        // eSewa's UAT ends a login session that sits for about five minutes, and
        // reports it as a plain failure. Say so while the payer can still act on
        // it — the replica has no such clock.
        note: demo
          ? `Replica of the ${method === "esewa" ? "eSewa" : "Khalti"} page — nothing leaves this app, and no real money moves.`
          : method === "esewa"
            ? "eSewa's test session ends about 5 minutes after login — finish in one go."
            : "Khalti test payer: 9800000001 · MPIN 1111 · OTP 987654.",
      });

      return true;
    }

    return false;
  }

  if (plan.kind === "gateway") return openGatewayUrl(plan.url);

  if (plan.kind === "form") {
    if (postEsewaForm(plan.url, plan.fields)) {
      // The form owns the tab now; nothing left to release.
      reservedTab = null;
      return true;
    }

    return false;
  }

  return false;
}
