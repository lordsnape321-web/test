/**
 * The one place that knows where the backend lives.
 *
 * This is the React Native counterpart of src/lib/api.ts in the Next.js app.
 * The contract is deliberately the same shape — apiUrl / apiFetch / apiGet — so
 * screens port across without their call sites changing.
 *
 * Two things differ from the web version, both because React Native is not a
 * browser:
 *
 *   1. The env prefix is EXPO_PUBLIC_, not NEXT_PUBLIC_. Expo inlines only
 *      EXPO_PUBLIC_* variables into the bundle at build time.
 *   2. There is no origin. A relative path like "/api/venues" is not a valid URL
 *      here and fetch() will throw, so a base is mandatory rather than optional.
 *
 * Point this at the running Next.js API during the migration:
 *
 *   EXPO_PUBLIC_API_BASE=http://localhost:3000      # iOS simulator
 *   EXPO_PUBLIC_API_BASE=http://10.0.2.2:3000       # Android emulator
 *   EXPO_PUBLIC_API_BASE=http://192.168.1.20:3000   # physical device, same Wi-Fi
 *
 * `localhost` on a device is the device itself, not your machine — that is the
 * most common reason a fresh Expo app cannot reach a local API.
 *
 * Later, swap the same variable to the Laravel host and nothing else changes.
 */

const NATIVE_DEFAULT_BASE = "http://localhost:3000";
const API_TIMEOUT_MS = 20_000;

/**
 * Browsers must never be shipped a localhost API URL: on a user's device that
 * points back to the user's own machine. Web uses same-origin `/api` calls and
 * the Expo dev server proxies them to the Next.js app; native keeps the useful
 * simulator default and can be overridden with EXPO_PUBLIC_API_BASE.
 */
const configuredBase = process.env.EXPO_PUBLIC_API_BASE?.trim() ?? "";
const runningInBrowser = typeof window !== "undefined";
const configuredIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(configuredBase);
const resolvedBase = runningInBrowser && configuredIsLocal ? "" : configuredBase;

/** Backend origin, without a trailing slash. Empty means same-origin `/api`. */
export const API_BASE = (resolvedBase || (runningInBrowser ? "" : NATIVE_DEFAULT_BASE)).replace(/\/+$/, "");

/**
 * Resolve an API path to an absolute URL.
 *
 * Already-absolute URLs are returned untouched so a gateway redirect can never
 * get the base prepended to it.
 */
export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}

/**
 * Drop-in replacement for fetch() on API paths.
 *
 * A thin wrapper on purpose: `init` is forwarded untouched, so JSON bodies,
 * FormData uploads, headers and AbortSignal all keep working.
 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(input), init);
}

/** Thrown by apiJson when the server responds with a non-2xx status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Whatever JSON body came back, when the server sent one. */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Pull a readable message out of an error response, whatever shape it is. */
function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const e = (body as { error?: unknown }).error;
    if (typeof e === "string" && e.trim()) return e;
  }
  return fallback;
}

/**
 * Build a message for a network-level failure — fetch threw, so no HTTP response
 * ever came back (DNS failure, connection refused, unreachable host, TLS error).
 *
 * It names the URL on purpose. The single most common cause on a device is a
 * base of "localhost"/"127.0.0.1", which on a phone or emulator refers to the
 * device itself rather than the dev machine, so nothing is listening. Saying so
 * turns a dead-end "check your connection" into the actual fix.
 */
function networkMessage(url: string, e: unknown): string {
  const detail = e instanceof Error ? e.message : String(e);
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // Unparseable URL — leave host blank and fall through to the generic text.
  }
  if (host === "localhost" || host === "127.0.0.1") {
    return (
      `Cannot reach the API at ${url}. "${host}" means this device itself — on a ` +
      `phone or emulator that is not your computer. Set EXPO_PUBLIC_API_BASE to your ` +
      `computer's LAN IP (physical device, same Wi-Fi) or 10.0.2.2 (Android emulator), ` +
      `then restart Expo. (${detail})`
    );
  }
  return `Cannot reach the API at ${url}. Is the backend running and on the same network? (${detail})`;
}

/**
 * GET/POST and parse JSON, throwing ApiError on a non-2xx response.
 *
 * The Next.js app's screens each hand-rolled `if (!res.ok)`. Doing it once here
 * means every screen gets the server's actual error message instead of a
 * generic one — which matters because these routes return specific strings like
 * "That court is already booked for this slot".
 *
 * A network-level failure (fetch throws, no response) is also converted to an
 * ApiError — with status 0 — so callers have one error type to handle and the
 * message names the unreachable URL instead of vanishing behind a generic one.
 */
export async function apiJson<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, headers, ...rest } = init ?? {};
  const url = apiUrl(path);
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, API_TIMEOUT_MS);
  const parentSignal = rest.signal;
  const abortFromParent = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  let res: Response;
  try {
    res = await apiFetch(path, {
      ...rest,
      signal: controller.signal,
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch (e) {
    if (timedOut) {
      throw new ApiError(
        0,
        `The API took too long to respond at ${url}. Check the backend connection and try again.`,
      );
    }
    // No response at all — connection/DNS/TLS level. Status 0 marks "never got
    // an HTTP status", distinct from any real 4xx/5xx the server could return.
    throw new ApiError(0, networkMessage(url, e));
  } finally {
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }

  // 204 and empty bodies are legitimate; don't try to parse them.
  const text = await res.text();
  const body = text ? safeParse(text) : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, messageFrom(body, `Request failed (${res.status})`), body);
  }
  return body as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}
