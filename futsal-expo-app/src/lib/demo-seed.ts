/**
 * The development seed, run once per app session instead of once per screen.
 *
 * `POST /api/seed` fills a fresh database with the Nepal demo data. Four screens
 * used to `await seedDemo()` *before* their real reads — Home, Venues, Teams and
 * the auth screens — which meant:
 *
 *   • every screen load paid a serialized round trip before its own data (two
 *     queued requests on a dev server that answers one at a time);
 *   • the seed is a POST, so it could never join the batched reads;
 *   • the same work was attempted again on every visit, even though the server's
 *     seeder is idempotent and its only useful answer is the first one.
 *
 * Now it is memoized: the first caller starts it, everybody else (and every
 * later screen) gets the same promise. Screens read first and only fall back to
 * the seed when the read came back empty, so a database that already has data —
 * every database in real use — never waits on it at all.
 */

import { seedDemo } from "@/api";

type SeedState = "idle" | "running" | "done" | "failed";

let state: SeedState = "idle";
let inflight: Promise<boolean> | null = null;
let lastError: unknown = null;

/** Has the seed been tried this session? */
export function demoSeedAttempted(): boolean {
  return state === "done" || state === "failed";
}

/** Why it failed, if it did — screens show this only when there is no data. */
export function demoSeedError(): unknown {
  return lastError;
}

/**
 * Run the idempotent demo seed at most once per app session.
 *
 * @returns true when the seed ran (or had already run) without error
 */
export function ensureDemoSeed(): Promise<boolean> {
  if (state === "done") return Promise.resolve(true);
  if (state === "failed") return Promise.resolve(false);
  if (inflight) return inflight;

  state = "running";

  inflight = seedDemo()
    .then(() => {
      state = "done";
      return true;
    })
    .catch((error: unknown) => {
      lastError = error;
      state = "failed";
      return false;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}
