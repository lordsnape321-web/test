#!/usr/bin/env node
/**
 * Removes what the API test suites leave behind 🧹
 *
 *   node tests/cleanup.mjs            # dry run — prints what it would delete
 *   node tests/cleanup.mjs --force    # actually delete
 *
 * The suites create real venues, courts, bookings and players through the real
 * API, and they never remove them — so after a few runs the venue list is
 * mostly test venues. Nothing cascades: this schema declares no foreign keys
 * at all (`grep -c "references(" src/db/schema.ts` is 0), so the children have
 * to be deleted explicitly and in order.
 *
 * Which venues count as test data is derived from the suite source rather than
 * a hand-kept list, so adding a venue to a suite cannot make this script miss
 * it. Minted players are recognised by the name `ensureFreshPlayers` gives
 * them.
 *
 * Seeded data is never matched: the seed venues (src/app/api/seed/route.ts,
 * `seedVenues`) are "Dhanyentari Futsal Arena", "KickOff Sports Hub",
 * "GoalZone Futsal Park", "Lakeside Strikers Court", "Rhino Sports Complex"
 * and "NightOwl Futsal", and the seed players are real Nepali names — neither
 * pattern appears in tests/api/. Note that "Chabahil Chargers" and friends are
 * seed *teams*, not venues, and are not touched either.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { Client } = require("pg");

const DSN = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const force = process.argv.includes("--force");

/** Venue and court names the suites create, read out of the suites themselves. */
function suiteNames() {
  const names = new Set();
  for (const file of readdirSync(join(here, "api")).filter((f) => f.endsWith(".mjs"))) {
    const src = readFileSync(join(here, "api", file), "utf8");
    for (const match of src.matchAll(/name:\s*"([^"]+)"/g)) names.add(match[1]);
  }
  return [...names];
}

const client = new Client({ connectionString: DSN });
await client.connect();

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0]?.n ?? 0;
const ids = async (sql, params = []) =>
  (await client.query(sql, params)).rows.map((r) => Number(r.id));

try {
  const names = suiteNames();

  const venueIds = await ids("select id from venues where name = any($1::text[])", [names]);
  const courtIds = await ids("select id from courts where venue_id = any($1::int[])", [venueIds]);
  // Bookings reached two ways: on a test court, or placed by a minted player.
  const mintedIds = await ids("select id from users where name like 'Test Runner %'");
  const bookingIds = await ids(
    "select distinct id from bookings where court_id = any($1::int[]) or user_id = any($2::int[])",
    [courtIds, mintedIds]
  );

  // Children first. No FK constraints exist, so this order is about leaving no
  // row pointing at something we are about to remove.
  const plan = [
    ["booking_extras", "delete from booking_extras where booking_id = any($1::int[])", [bookingIds]],
    ["booking_payments", "delete from booking_payments where booking_id = any($1::int[])", [bookingIds]],
    ["reviews", "delete from reviews where booking_id = any($1::int[]) or venue_id = any($2::int[])", [bookingIds, venueIds]],
    ["open_matches", "delete from open_matches where booking_id = any($1::int[]) or court_id = any($2::int[]) or venue_id = any($3::int[])", [bookingIds, courtIds, venueIds]],
    ["tournament_matches", "delete from tournament_matches where booking_id = any($1::int[]) or court_id = any($2::int[])", [bookingIds, courtIds]],
    ["tournament_payments", "delete from tournament_payments where user_id = any($1::int[])", [mintedIds]],
    ["match_joins", "delete from match_joins where user_id = any($1::int[])", [mintedIds]],
    ["team_members", "delete from team_members where user_id = any($1::int[])", [mintedIds]],
    ["team_requests", "delete from team_requests where user_id = any($1::int[])", [mintedIds]],
    ["team_invites", "delete from team_invites where user_id = any($1::int[])", [mintedIds]],
    ["notifications", "delete from notifications where user_id = any($1::int[])", [mintedIds]],
    ["vouchers", "delete from vouchers where user_id = any($1::int[]) or venue_id = any($2::int[])", [mintedIds, venueIds]],
    ["promos", "delete from promos where venue_id = any($1::int[])", [venueIds]],
    ["bookings", "delete from bookings where id = any($1::int[])", [bookingIds]],
    ["courts", "delete from courts where id = any($1::int[])", [courtIds]],
    ["venues", "delete from venues where id = any($1::int[])", [venueIds]],
    ["users", "delete from users where id = any($1::int[])", [mintedIds]],
  ];

  console.log(
    `\nMatched ${venueIds.length} test venue(s), ${courtIds.length} court(s), ` +
      `${bookingIds.length} booking(s), ${mintedIds.length} minted player(s)\n`
  );

  let total = 0;
  for (const [table, sql, params] of plan) {
    // Count with the same predicate the delete uses, so the dry run cannot
    // disagree with what --force actually removes.
    const countSql = sql.replace(/^delete from (\w+)/, "select count(*)::int as n from $1");
    const n = await one(countSql, params);
    if (n === 0) continue;

    if (force) {
      // Trust the delete's own rowCount, not the earlier count: the number
      // printed has to be the number of rows that actually went.
      const res = await client.query(sql, params);
      total += res.rowCount;
      console.log(`  deleted ${String(res.rowCount).padStart(5)}  ${table}`);
    } else {
      total += n;
      console.log(`  would delete ${String(n).padStart(5)}  ${table}`);
    }
  }

  if (total === 0) {
    console.log("Nothing to clean up.");
  } else if (!force) {
    console.log(`\n${total} row(s) would be removed. Re-run with --force to delete them.`);
  } else {
    console.log(`\nRemoved ${total} row(s).`);
  }
} finally {
  await client.end();
}
