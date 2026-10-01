/**
 * The gateway page, opened inside the app.
 *
 * On a phone there is no reason to leave the app to pay: the same form the app
 * would POST in a system browser can be posted in a WebView, and the return URL
 * can be intercepted before the WebView ever tries to load it. That is what
 * this store carries — the checkout to show, and the URL prefixes that mean
 * "done, get out and verify".
 *
 * Plain data on purpose (a URL, a form body, a couple of strings), so the sheet
 * that renders it stays trivial and this can be reasoned about without any UI.
 */
export type InAppGatewaySession = {
  /** Which gateway, for the sheet's header. */
  method: "esewa" | "khalti";
  /** Where the form or the payment page is. */
  url: string;
  /** eSewa is a POST: these are the signed fields. Khalti needs none. */
  fields?: Record<string, string>;
  /**
   * Any URL starting with one of these means the checkout is over — the sheet
   * closes and the app takes over (verify, then show the result).
   */
  returnPrefixes: string[];
  /** A human label for the sheet's header: "booking #12", "league entry". */
  label: string;
};

let session: InAppGatewaySession | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/** Show the checkout sheet. Replaces any sheet already open. */
export function openInAppGateway(next: InAppGatewaySession): void {
  session = next;
  announce();
}

/** The checkout the sheet should be showing, if any. */
export function currentInAppGateway(): InAppGatewaySession | null {
  return session;
}

/** Close the sheet (the player cancelled, or the return has been handled). */
export function closeInAppGateway(): void {
  session = null;
  announce();
}

/** Subscribe to sheet changes; returns the unsubscribe. */
export function subscribeInAppGateway(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** The form body eSewa expects, as `application/x-www-form-urlencoded`. */
export function formBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");
}

/** True when this URL is one of the checkout's own return addresses. */
export function isReturnUrl(url: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => prefix !== "" && url.startsWith(prefix));
}

/**
 * The query string of a return URL, decoded — `?data=…`, `?pidx=…&status=…`.
 *
 * Returned as a plain object so the sheet can hand it to the in-app route that
 * owns verification, which is the same route a browser would have landed on.
 */
export function returnParams(url: string): Record<string, string> {
  const query = url.split("?")[1] ?? "";
  const params: Record<string, string> = {};

  for (const pair of query.split("&")) {
    if (pair === "") continue;

    const [rawName, ...rawValue] = pair.split("=");
    const name = decodeURIComponent(rawName.replace(/\+/g, " "));

    params[name] = decodeURIComponent(rawValue.join("=").replace(/\+/g, " "));
  }

  return params;
}
