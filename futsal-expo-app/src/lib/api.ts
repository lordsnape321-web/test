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

const DEFAULT_BASE = "http://localhost:3000";

/** Backend origin, without a trailing slash. */
export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");

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
 * GET/POST and parse JSON, throwing ApiError on a non-2xx response.
 *
 * The Next.js app's screens each hand-rolled `if (!res.ok)`. Doing it once here
 * means every screen gets the server's actual error message instead of a
 * generic one — which matters because these routes return specific strings like
 * "That court is already booked for this slot".
 */
export async function apiJson<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, headers, ...rest } = init ?? {};
  const res = await apiFetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });

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
