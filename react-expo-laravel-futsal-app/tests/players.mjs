// Player allocation for the live API suites.
//
// The app caps a player at CANCEL_LIMIT_PER_MONTH cancellations ("Whoa, slow
// down! 🛑"). Several suites cancel bookings on purpose, so handing the same
// user id to more than one suite makes a later suite trip that cap and then
// cascade into nonsense failures — a booking POST returns 403, `booking` is
// undefined, and every downstream assertion fails for a reason that has
// nothing to do with the code under test.
//
// So instead of hard-coding ids, we ask the database who still has room and
// hand out distinct players to each slot.

import { createRequire } from "node:module";

// `pg` is a dependency of the app, resolved from wherever the checkout lives.
const require = createRequire(import.meta.url);
const { Client } = require("pg");

export const CANCEL_LIMIT_PER_MONTH = 3;

/**
 * Cancellations this month per user, counted the same way the app counts them
 * in `playerStats` (src/lib/loyalty.ts): status === "cancelled" AND createdAt
 * on/after the first of the current month, in local time.
 */
export async function cancelHeadroom(dsn) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const client = new Client({ connectionString: dsn });
  await client.connect();
  try {
    const res = await client.query(
      `select u.id,
              coalesce(u.role, 'player') as role,
              count(b.id) filter (where b.status = 'cancelled' and b.created_at >= $1)::int as cancels
         from users u
         left join bookings b on b.user_id = u.id
        group by u.id, u.role
        order by u.id`,
      [monthStart]
    );
    const byUser = new Map();
    for (const row of res.rows) {
      byUser.set(Number(row.id), {
        id: Number(row.id),
        role: String(row.role),
        cancels: Number(row.cancels),
        headroom: CANCEL_LIMIT_PER_MONTH - Number(row.cancels),
      });
    }
    return byUser;
  } finally {
    await client.end();
  }
}

/**
 * Register a brand-new player through the real signup route and return its id.
 *
 * A fresh account has zero cancellations, so it can always carry a suite that
 * cancels on purpose. Minting instead of reusing seeded players is what makes
 * `npm run test:api` repeatable: the seeded accounts permanently accrue
 * cancellations and eventually cannot book at all.
 *
 * Returns `null` if signup failed (the caller then falls back to whatever
 * headroom the database already had).
 */
export async function mintPlayer(baseUrl, tag) {
  const stamp = Date.now().toString(36);
  // Digits only, and not the same digit repeated — validatePhone rejects both.
  const digits = String(Date.now()).slice(-8) + String(tag.length).padStart(2, "0");
  const res = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Test Runner ${tag}`,
      email: `runner.${tag}.${stamp}@example.com`,
      phone: `98${digits}`,
      password: `runner-${stamp}`,
      role: "player",
    }),
  });
  const body = await res.json().catch(() => null);
  if (res.status !== 201) return null;
  return { id: Number(body?.user?.id), name: String(body?.user?.name ?? `Test Runner ${tag}`) };
}

/**
 * Mint one fresh player per slot.
 *
 * Fresh accounts make the suites deterministic in two ways at once:
 *
 *  1. Zero cancellations, so a suite that cancels on purpose never trips the
 *     3-a-month cap — which is what made `npm run test:api` fail differently
 *     on every run once the seeded players had accrued cancels.
 *  2. No booking history at all, so `depositDecision` (src/lib/loyalty.ts)
 *     skips every branch: the rating branch needs `total > 0`, and the
 *     cancel/trust branches need history. A seeded player with a 2.5★ rating
 *     silently got a 30% deposit demanded, so the gateway charged 540 of an
 *     1,800 booking and the ledger looked wrong when it was behaving exactly
 *     as designed.
 *
 * The exception is `deposit-split.mjs`, which *wants* a deposit: it burns two
 * cancellations itself to earn one.
 */
export async function ensureFreshPlayers(baseUrl, suites, byUser) {
  const minted = [];
  for (const suite of suites) {
    for (const name of Object.keys(suite.slots)) {
      const fresh = await mintPlayer(baseUrl, `${suite.file.replace(/\.mjs$/, "")}${name}`);
      if (!fresh) continue;
      byUser.set(fresh.id, {
        id: fresh.id,
        role: "player",
        cancels: 0,
        headroom: CANCEL_LIMIT_PER_MONTH,
      });
      minted.push(`${suite.file} ${name} → new player ${fresh.id}`);
    }
  }
  return minted;
}

/**
 * Assign a distinct user to every slot of every suite.
 *
 * `suites` is a list of `{ file, slots }` where `slots` maps an env var name to
 * the number of cancellations that slot is going to cause. Players are picked
 * greedily from whoever has the most headroom left, never reusing a player
 * inside one suite.
 *
 * Returns `{ env, problems, plan }`. `env` maps a suite filename to the env it
 * should be spawned with; `problems` lists any slot that could not be filled.
 */
export function allocatePlayers(suites, byUser, limit = CANCEL_LIMIT_PER_MONTH) {
  const remaining = new Map();
  for (const [id, info] of byUser) remaining.set(id, limit - info.cancels);

  const env = new Map();
  const problems = [];
  const plan = [];

  for (const suite of suites) {
    const suiteEnv = {};
    const usedInSuite = new Set();

    for (const [name, cancels] of Object.entries(suite.slots)) {
      let best = null;
      for (const [id, left] of remaining) {
        if (usedInSuite.has(id)) continue;
        if (left < cancels) continue;
        // Prefer players over owners, then whoever has the most room.
        const better =
          best === null ||
          left > remaining.get(best) ||
          (left === remaining.get(best) &&
            byUser.get(id)?.role === "player" &&
            byUser.get(best)?.role !== "player");
        if (better) best = id;
      }

      if (best === null) {
        problems.push(
          `${suite.file}:${name} needs ${cancels} cancel(s) but no player has that much headroom left`
        );
        continue;
      }

      remaining.set(best, remaining.get(best) - cancels);
      usedInSuite.add(best);
      suiteEnv[name] = String(best);
      plan.push(`${suite.file} ${name}=${best} (burns ${cancels}, ${remaining.get(best)} left)`);
    }

    env.set(suite.file, suiteEnv);
  }

  return { env, problems, plan };
}
