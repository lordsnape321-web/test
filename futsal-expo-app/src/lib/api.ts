import { noteRequest } from "@/lib/perf";
import { STORAGE_KEYS, storage } from "@/lib/storage";

/**
 * The one place that knows where the backend lives.
 *
 * This is the network seam for the Expo app. Every screen goes through this
 * module, so the client has one backend origin and one error-handling path.
 *
 * Two things differ from the web version, both because React Native is not a
 * browser:
 *
 *   1. Expo inlines only EXPO_PUBLIC_* variables into the bundle at build time,
 *      so the backend setting must use that prefix.
 *   2. There is no origin. A relative path like "/api/venues" is not a valid URL
 *      here and fetch() will throw, so a base is mandatory rather than optional.
 *
 * The backend is Laravel (`../laravel`) and listens on port 8000 locally:
 *
 *   EXPO_PUBLIC_API_BASE=http://localhost:8000      # iOS simulator
 *   EXPO_PUBLIC_API_BASE=http://10.0.2.2:8000       # Android emulator
 *   EXPO_PUBLIC_API_BASE=http://192.168.1.20:8000   # physical device, same Wi-Fi
 *
 * `localhost` on a device is the device itself, not your machine — that is the
 * most common reason a fresh Expo app cannot reach a local API. Set this value
 * to the Laravel host before creating a native build.
 *
 * An installed build has no Metro server to derive anything from, so it can
 * also be pointed at a backend from the sign-in screen ("Server address"),
 * which is saved with `setSavedApiBase()` and wins over the build default.
 * Everything resolves through `apiBase()`, so a change takes effect on the very
 * next request.
 */

const NATIVE_DEFAULT_BASE = "http://localhost:8000";
const API_TIMEOUT_MS = 20_000;

/**
 * Browsers must never be shipped a localhost API URL: on a user's device that
 * points back to the user's own machine. Web uses same-origin `/api` calls and
 * the Expo dev server proxies them to the Laravel service; native uses the
 * simulator default and can be overridden with EXPO_PUBLIC_API_BASE.
 */
const configuredBase = process.env.EXPO_PUBLIC_API_BASE?.trim() ?? "";
const runningInBrowser = typeof window !== "undefined";
const configuredIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(configuredBase);
const resolvedBase = runningInBrowser && configuredIsLocal ? "" : configuredBase;

/**
 * A backend address saved on this device, or "".
 *
 * This is what makes an installed APK usable: it was built without a dev
 * server to derive an origin from, and the Laravel backend usually sits on the
 * machine the person is developing on, on their own Wi-Fi (`http://192.168.1.20:8000`
 * and the like). The login screen can save one, and it wins over the build
 * default but never over an explicit same-origin web build.
 */
export function savedApiBase(): string {
  return (storage.getCached(STORAGE_KEYS.apiBase) ?? "").trim().replace(/\/+$/, "");
}

/** Save (or clear, with "") the backend origin for this device. */
export function setSavedApiBase(origin: string): void {
  const clean = origin.trim().replace(/\/+$/, "");
  if (clean) void storage.set(STORAGE_KEYS.apiBase, clean);
  else void storage.remove(STORAGE_KEYS.apiBase);
}

/** What a request would use right now. Empty means same-origin `/api`. */
export function apiBase(): string {
  const saved = savedApiBase();
  if (saved) return saved;
  return (resolvedBase || (runningInBrowser ? "" : NATIVE_DEFAULT_BASE)).replace(/\/+$/, "");
}

/** The build's own default, shown in the UI when nothing is saved. */
export function defaultApiBase(): string {
  return (resolvedBase || (runningInBrowser ? "" : NATIVE_DEFAULT_BASE)).replace(/\/+$/, "");
}


/**
 * Resolve an API path to an absolute URL.
 *
 * Already-absolute URLs are returned untouched so a gateway redirect can never
 * get the base prepended to it.
 */
export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase()}${normalized}`;
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
  if (!body || typeof body !== "object") return fallback;

  const payload = body as {
    error?: unknown;
    message?: unknown;
    errors?: unknown;
  };

  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;

  // Keep this tolerant of Laravel's default validation envelope too. The
  // application normally returns `{ error }`, but a proxy, package, or future
  // controller should not turn a useful field-level failure into "Request
  // failed (422)".
  if (payload.errors && typeof payload.errors === "object") {
    for (const value of Object.values(payload.errors as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        const first = value.find((item) => typeof item === "string" && item.trim());
        if (typeof first === "string") return first;
      }
      if (typeof value === "string" && value.trim()) return value;
    }
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
  // Android blocks plain http in a release build unless the app opts in
  // (`usesCleartextTraffic`, set from app.json via expo-build-properties). The
  // platform's own wording — "CLEARTEXT communication to … not permitted by
  // network security policy" — says nothing about what to do, so this does.
  if (/cleartext|network security policy/i.test(detail)) {
    return (
      `Android blocked the plain-http request to ${url}. This build allows LAN ` +
      `http — install the newest APK if you are on an older one — or point the ` +
      `Server row at an https:// address. (${detail})`
    );
  }
  if (host === "localhost" || host === "127.0.0.1") {
    return (
      `Cannot reach the API at ${url}. "${host}" means this device itself — on a ` +
      `phone or emulator that is not your computer. Sign in screen → Server address: ` +
      `set it to your computer's LAN IP on the same Wi-Fi (e.g. http://192.168.1.20:8000), ` +
      `or 10.0.2.2 for the Android emulator. (${detail})`
    );
  }
  return `Cannot reach the API at ${url}. Is the backend running and on the same network? (${detail})`;
}

/**
 * GET/POST and parse JSON, throwing ApiError on a non-2xx response.
 *
 * Screens should not hand-roll `if (!res.ok)`. Doing it once here means every
 * screen gets Laravel's actual error message instead of a generic one — which
 * matters because these routes return specific strings like
 * "That court is already booked for this slot".
 *
 * A network-level failure (fetch throws, no response) is also converted to an
 * ApiError — with status 0 — so callers have one error type to handle and the
 * message names the unreachable URL instead of vanishing behind a generic one.
 *
 * Reads are batched: see `apiJson` below.
 */
type JsonInit = RequestInit & { json?: unknown; timeoutMs?: number };

async function rawJson<T>(path: string, init?: JsonInit): Promise<T> {
  const { json, headers, timeoutMs, ...rest } = init ?? {};
  const url = apiUrl(path);
  const startedAt = Date.now();
  const method = (rest.method ?? "GET").toUpperCase();
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs ?? API_TIMEOUT_MS);
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
      const error = new ApiError(
        0,
        `The API took too long to respond at ${url}. Check the backend connection and try again.`,
      );
      noteRequest(`${method} ${path}`, Date.now() - startedAt, false, "timed out");
      if (process.env.NODE_ENV !== "production") {
        console.error("[Laravel API] request timed out", { url, error });
      }
      throw error;
    }
    // No response at all — connection/DNS/TLS level. Status 0 marks "never got
    // an HTTP status", distinct from any real 4xx/5xx the server could return.
    const error = new ApiError(0, networkMessage(url, e));
    noteRequest(`${method} ${path}`, Date.now() - startedAt, false, "no response");
    if (process.env.NODE_ENV !== "production") {
      console.error("[Laravel API] request could not connect", { url, error, cause: e });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }

  // 204 and empty bodies are legitimate; don't try to parse them.
  const text = await res.text();
  const body = text ? safeParse(text) : undefined;

  if (!res.ok) {
    const error = new ApiError(res.status, messageFrom(body, `Request failed (${res.status})`), body);
    noteRequest(`${method} ${path}`, Date.now() - startedAt, false, `HTTP ${res.status}`);
    if (process.env.NODE_ENV !== "production") {
      console.error("[Laravel API] backend returned an error", {
        url,
        status: res.status,
        message: error.message,
        body,
      });
    }
    throw error;
  }

  noteRequest(`${method} ${path}`, Date.now() - startedAt, true, `HTTP ${res.status}`);

  return body as T;
}

/* ── read batching ───────────────────────────────────────────────────────── */

/**
 * The dev server answers one request at a time, so six reads from one screen are
 * six queued round trips, each paying Laravel's boot cost before it says
 * anything. Reads issued in the same tick — which is what `Promise.all` over
 * several fetch helpers is — are collected here and sent as a single POST to
 * `/api/batch`, which replays them in one already-booted process.
 *
 * Nothing above this layer changes: `fetchVenue()` and `fetchCourts()` are still
 * the calls a screen makes, and each still resolves to the same body or rejects
 * with the same ApiError.
 *
 * Three guards keep this from being clever at the app's expense:
 *
 *   • only plain GETs with no body, headers or AbortSignal are batched — a
 *     request whose caller can cancel it stays a request of its own;
 *   • a lone read is sent directly, so nothing waits on a batch that will never
 *     have a second member;
 *   • if the batch route is missing or unhappy (an older backend, a proxy that
 *     drops POST), the reads are re-issued individually and batching stands down
 *     for a minute rather than failing the screen.
 */

/** The server's own cap; mirrored here so a big flush is sent in legal chunks. */
const BATCH_MAX = 12;

const BATCH_TIMEOUT_MS = 30_000;

/** After a batch fails at the transport level, don't try again for this long. */
const BATCH_COOLDOWN_MS = 60_000;

type QueuedRead = {
  path: string;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

let readQueue: QueuedRead[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let batchingDisabledUntil = 0;
let warnedAboutBatching = false;

/** Is this request one the batch route can carry? */
function canBatch(path: string, init?: JsonInit): boolean {
  if (Date.now() < batchingDisabledUntil) return false;
  if (!path.startsWith("/api/")) return false;
  if (path.startsWith("/api/batch")) return false;
  if (!init) return true;
  if (init.method && init.method.toUpperCase() !== "GET") return false;
  if (init.json !== undefined || init.body !== undefined) return false;
  if (init.signal || init.headers) return false;
  return true;
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushReads();
  }, 0);
}

async function flushReads(): Promise<void> {
  const items = readQueue;
  readQueue = [];

  if (items.length === 0) return;

  // A single read is not worth a second hop.
  if (items.length === 1) {
    const [only] = items;
    rawJson(only.path).then(only.resolve, only.reject);
    return;
  }

  // The same path twice in one tick (two screens wanting the venue list) is one
  // read; both callers get the same answer.
  const byPath = new Map<string, QueuedRead[]>();
  const unique: string[] = [];

  for (const item of items) {
    const existing = byPath.get(item.path);

    if (existing) {
      existing.push(item);
      continue;
    }

    byPath.set(item.path, [item]);
    unique.push(item.path);
  }

  for (let start = 0; start < unique.length; start += BATCH_MAX) {
    await sendChunk(unique.slice(start, start + BATCH_MAX), byPath);
  }
}

function settlePath(byPath: Map<string, QueuedRead[]>, path: string, ok: boolean, value: unknown): void {
  for (const item of byPath.get(path) ?? []) {
    if (ok) item.resolve(value);
    else item.reject(value);
  }
}

/** Ask for every path again as its own request. Used when batching is unusable. */
async function readIndividually(paths: string[], byPath: Map<string, QueuedRead[]>): Promise<void> {
  await Promise.all(
    paths.map(async (path) => {
      try {
        settlePath(byPath, path, true, await rawJson(path));
      } catch (e) {
        settlePath(byPath, path, false, e);
      }
    }),
  );
}

function standDown(): void {
  batchingDisabledUntil = Date.now() + BATCH_COOLDOWN_MS;

  if (!warnedAboutBatching && process.env.NODE_ENV !== "production") {
    warnedAboutBatching = true;
    console.warn("[Laravel API] /api/batch unavailable — reading one request at a time");
  }
}

async function sendChunk(paths: string[], byPath: Map<string, QueuedRead[]>): Promise<void> {
  let payload: { responses?: unknown };
  const startedAt = Date.now();

  try {
    payload = await rawJson<{ responses?: unknown }>("/api/batch", {
      method: "POST",
      json: { requests: paths.map((path) => ({ path })) },
      timeoutMs: BATCH_TIMEOUT_MS,
    });
  } catch {
    standDown();
    await readIndividually(paths, byPath);
    return;
  }

  const rows = Array.isArray(payload?.responses) ? payload.responses : [];

  if (rows.length !== paths.length) {
    standDown();
    await readIndividually(paths, byPath);
    return;
  }

  noteRequest("POST /api/batch", Date.now() - startedAt, true, `(${paths.length} reads)`);

  paths.forEach((path, index) => {
    const row = rows[index] as { status?: unknown; body?: unknown } | null;
    const status = Number(row?.status ?? 0);
    const body = row?.body;

    if (status >= 200 && status < 300) {
      settlePath(byPath, path, true, body);
      return;
    }

    settlePath(
      byPath,
      path,
      false,
      new ApiError(status || 500, messageFrom(body, `Request failed (${status || 500})`), body),
    );
  });
}

/**
 * The call every screen already makes.
 *
 * Reads are queued for the next flush (one tick away, so `Promise.all` over
 * several helpers lands in the same batch); everything else goes straight to the
 * network as before.
 */
export function apiJson<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  if (canBatch(path, init)) {
    return new Promise<T>((resolve, reject) => {
      readQueue.push({ path, resolve: resolve as (value: unknown) => void, reject });
      scheduleFlush();
    });
  }

  return rawJson<T>(path, init);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}
