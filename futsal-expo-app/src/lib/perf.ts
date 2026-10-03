/**
 * Client-side timing, so "the app is slow" can be answered the same way the
 * server answers it.
 *
 * The backend now reports its own numbers on `/api/health`, and they came back
 * fast — a median of a few milliseconds per request. When the server says it is
 * quick and the screen still feels slow, the time is being spent here: parsing
 * the bundle, loading fonts, downloading an image, or waiting on a request that
 * never left the device.
 *
 * So this does for the client what `App\Support\PerfLog` does for the server:
 * it writes a handful of `[perf]` lines to the console (the Metro terminal for
 * native, the browser console for web) and nothing else. No UI, no dependency,
 * no network. In a production build it compiles down to a few no-op calls.
 *
 * What to look for, in order:
 *
 *   [perf] bundle evaluated …        — script parse + module graph (dev bundle
 *                                      is unminified: try `npm run start:fast`)
 *   [perf] fonts ready …             — the app is gated on this
 *   [perf] app ready …               — first screen mounted
 *   [perf] POST /api/batch 412ms     — a request the user waited on
 */

const ENABLED = process.env.NODE_ENV !== "production";

/** When this module was first evaluated — the closest thing to "app start". */
const startedAt = Date.now();

type Sample = { label: string; ms: number; at: number };

const samples: Sample[] = [];

let announced = false;

/** Milliseconds since the bundle started evaluating. */
export function elapsed(): number {
  return Date.now() - startedAt;
}

/**
 * Record a milestone (fonts loaded, first screen mounted, …).
 *
 * @param label what finished
 * @param since an earlier `performance.now()`-style reading, if you have one
 */
export function mark(label: string, since?: number): void {
  const ms = since === undefined ? elapsed() : Math.round(Date.now() - since);

  samples.push({ label, ms, at: Date.now() });

  if (ENABLED) {
    console.log(`[perf] ${label} — ${ms}ms`);
  }
}

/** Called once, early, so the log makes clear what the numbers are measured from. */
export function announce(): void {
  if (!ENABLED || announced) return;
  announced = true;
  console.log("[perf] timing from bundle evaluation — see src/lib/perf.ts");
}

/**
 * Record one API request the way the client experienced it.
 *
 * Only the slow ones are logged by default: a console line per request would
 * drown the interesting ones, and the interesting ones are exactly the requests
 * a person is waiting on.
 */
export function noteRequest(path: string, ms: number, ok = true, detail = ""): void {
  const rounded = Math.round(ms);

  if (ms >= 300) {
    samples.push({ label: `${ok ? "" : "failed "}${path}`, ms: rounded, at: Date.now() });
  }

  if (ENABLED && ms >= 300) {
    console.log(`[perf] ${ok ? "" : "FAILED "}${path} — ${rounded}ms${detail ? ` ${detail}` : ""}`);
  }
}

/** The last few slow things, for a bug report. */
export function recent(): Sample[] {
  return samples.slice(-10);
}
