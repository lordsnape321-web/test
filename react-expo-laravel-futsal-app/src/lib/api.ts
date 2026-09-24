/**
 * The one place that knows where the backend lives.
 *
 * Why this exists
 * ---------------
 * Every network call in this app used to be a hardcoded relative path:
 * `fetch("/api/bookings")`. That works on the web because the browser resolves
 * it against the current origin — and it silently stops working the moment the
 * origin disappears or moves, which is exactly what happens twice here:
 *
 *   1. React Native has no origin at all. A relative URL is not a valid URL
 *      there; fetch() needs an absolute one.
 *   2. Laravel will be a separate host, so "/api/bookings" will no longer be
 *      the backend even when running in a browser.
 *
 * Routing all 140 call sites through here means both migrations are a single
 * environment variable instead of 140 hand-edits:
 *
 *   NEXT_PUBLIC_API_BASE=https://api.example.com
 *
 * It must be NEXT_PUBLIC_ so the value is inlined into the client bundle.
 *
 * With the variable unset, BASE is "" and apiUrl() returns the same relative
 * path the code used before — so this module is a behaviour-preserving
 * refactor of what was already there, not a change in how the app runs today.
 */

/** Backend origin, without a trailing slash. "" means "same origin". */
const BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/+$/, "");

/** True when calls go to a different origin than the app is served from. */
export const isRemoteApi = BASE !== "";

/**
 * Resolve an API path to the URL it should actually be requested from.
 *
 * Tolerates a leading slash or none, and rejects an already-absolute URL so a
 * stray "https://..." can never get the base prepended to it.
 */
export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${BASE}${normalized}`;
}

/**
 * Drop-in replacement for fetch() on API paths.
 *
 * Deliberately a thin wrapper rather than a full client: it forwards `init`
 * untouched, so JSON bodies, FormData uploads, headers, credentials and signal
 * all keep working exactly as they did, and no call site has to change shape.
 */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(input), init);
}

/** Convenience for the very common "GET this and parse the JSON" case. */
export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}
