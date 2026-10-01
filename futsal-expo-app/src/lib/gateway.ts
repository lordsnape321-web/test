import { Linking, Platform } from "react-native";
import type { CheckoutPlan } from "@/lib/gateway-plan";

/**
 * The platform half of the checkout bridge: opening tabs, navigating to a
 * gateway, and knowing where the app lives. The decisions live next door in
 * `gateway-plan.ts`, which stays free of `react-native` imports.
 */

export type { CheckoutPlan, GatewayInitiate, GatewayMethod } from "@/lib/gateway-plan";
export { esewaDataFromLocation, planCheckout } from "@/lib/gateway-plan";

const configuredMode = (process.env.EXPO_PUBLIC_PAYMENT_MODE ?? "").trim().toLowerCase();

/**
 * Where the gateway should send the browser when it is done.
 *
 * On the web this is simply the page's own origin — the app is served by Expo,
 * not by the API, and the two are different hosts even locally. A native build
 * has no origin at all, so it needs `EXPO_PUBLIC_APP_ORIGIN` (the Expo web dev
 * server, e.g. `http://192.168.1.20:8081`); without it a native build keeps
 * using the simulator, because a return URL that points nowhere would strand the
 * payment in the system browser.
 */
export function paymentReturnOrigin(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }

  return (process.env.EXPO_PUBLIC_APP_ORIGIN ?? "").trim().replace(/\/+$/, "");
}

/** False only when the build asks for the simulator, or a device has no return origin. */
export function realGatewayEnabled(): boolean {
  if (configuredMode === "simulator") return false;
  if (Platform.OS === "web") return true;

  return paymentReturnOrigin() !== "";
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
    void Linking.openURL(url).catch(() => undefined);
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

/** Run a plan. Returns false when the caller should fall back to the simulator. */
export function openCheckout(plan: CheckoutPlan): boolean {
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
