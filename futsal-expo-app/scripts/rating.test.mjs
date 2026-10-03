/**
 * The reliability rating, checked twice.
 *
 *   npx esbuild scripts/rating.test.mjs --bundle --platform=node --format=esm \
 *     --tsconfig=tsconfig.json --outfile=scripts/.tmp/rating.mjs && node scripts/.tmp/rating.mjs
 *
 * The rule this round fixed — "rating should move on payment, not only on
 * attendance" — is implemented on both sides of the wire: PHP derives it for
 * the profile, the player dossier and the booking cards (`Loyalty::playerRating`),
 * and `src/lib/loyalty.ts` is the documented mirror. Two implementations of one
 * rule is a promise to keep them equal, so the same scenarios are pushed through
 * both here and the answers have to match — including the expected numbers,
 * which are written out in this file rather than computed, since a test that
 * derives its own expectations proves nothing.
 *
 * The PHP half runs through `php` when the machine has one (a GitHub runner
 * does, and `laravel/tests/scripts/loyalty-rate-json.php` is written for exactly
 * this). Without a PHP binary the cross-check is skipped loudly and the
 * TypeScript side is still checked against the expected table, so the file is
 * useful on a phone-less laptop too.
 *
 * The readable version of the same rules is `laravel/tests/scripts/loyalty-rating.php`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bookingSettled, playerRating, trustAfterComplete, trustAfterPaid } from "../src/lib/loyalty";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");

/**
 * The repository root — found rather than counted.
 *
 * esbuild writes the bundle to `scripts/.tmp/`, one level deeper than the
 * source, so `join(here, "..")` means two different things depending on whether
 * this is running from source or bundled. Walking up to the directory that
 * holds `laravel/app/Support/Loyalty.php` works either way.
 */
function repoRootFrom(start) {
  let dir = start;

  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "laravel", "app", "Support", "Loyalty.php"))) return dir;
    dir = join(dir, "..");
  }

  return start;
}

const repoRoot = repoRootFrom(here);

const NOW = "2026-10-03 12:00:00";

let failed = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);

  if (!ok) failed++;

  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}` +
      (ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`),
  );
}

/* ── the scenarios, written once ─────────────────────────────────────────── */

const played = (over = {}) => ({
  status: "completed",
  created_at: "2026-09-20 18:00:00",
  payment_status: "paid",
  paid_amount: 1200,
  settled_at: "2026-09-20 18:00:00",
  total_price: 1200,
  ...over,
});

/** Played, but the venue is still waiting for its money. */
const owes = (over = {}) =>
  played({ payment_status: "pending", paid_amount: 0, settled_at: null, ...over });

const cancelled = (over = {}) => ({
  status: "cancelled",
  created_at: "2026-09-25 18:00:00",
  payment_status: "pending",
  paid_amount: 0,
  settled_at: null,
  total_price: 1200,
  ...over,
});

/**
 * `expected` is the contract: what the app tells a player their reliability is.
 * Changing a number here means changing the rule, on both sides.
 */
const scenarios = [
  { name: "new player", rows: [], expected: { rating: 5, paidGames: 0, unpaidGames: 0, label: "New player" } },
  {
    name: "four played and paid",
    rows: [played(), played(), played(), played()],
    expected: { rating: 5, paidGames: 4, unpaidGames: 0, label: "Super reliable" },
  },
  {
    name: "three played, one cancelled",
    rows: [played(), played(), played(), cancelled()],
    expected: { rating: 3.8, paidGames: 3, unpaidGames: 0, label: "Reliable" },
  },
  {
    name: "three paid, one still owing",
    rows: [played(), played(), played(), owes()],
    expected: { rating: 4.4, paidGames: 3, unpaidGames: 1, label: "Owes on a played game" },
  },
  {
    name: "played once, bill open",
    rows: [owes()],
    expected: { rating: 2.5, paidGames: 0, unpaidGames: 1, label: "Owes on a played game" },
  },
  {
    name: "the same game, settled",
    rows: [played()],
    expected: { rating: 5, paidGames: 1, unpaidGames: 0, label: "Super reliable" },
  },
  {
    name: "cancels only",
    rows: [cancelled(), cancelled()],
    expected: { rating: 3.4, paidGames: 0, unpaidGames: 0, label: "Needs care" },
  },
  {
    name: "one played, one cancelled",
    rows: [played(), cancelled()],
    expected: { rating: 2.5, paidGames: 1, unpaidGames: 0, label: "Needs care" },
  },
  {
    // Rows selected before round 7 carried no payment columns; they must not be
    // read as "owes money", or every existing player would lose stars on upgrade.
    name: "history without payment columns",
    rows: [
      { status: "completed", created_at: "2026-09-20 18:00:00" },
      { status: "completed", created_at: "2026-09-21 18:00:00" },
    ],
    expected: { rating: 5, paidGames: 2, unpaidGames: 0, label: "Super reliable" },
  },
  {
    // `settled_at` and `paid_amount` are the other two ways the ledger says the
    // money landed; the rating must see all three, not just `payment_status`.
    name: "settled at the desk",
    rows: [played({ payment_status: "pending", paid_amount: 1200, settled_at: "2026-09-22 10:00:00" })],
    expected: { rating: 5, paidGames: 1, unpaidGames: 0, label: "Super reliable" },
  },
];

console.log("\n=== reliability rating: PHP and TypeScript agree ===\n");

/* ── the TypeScript half ─────────────────────────────────────────────────── */

const byName = new Map(
  scenarios.map((s) => [
    s.name,
    playerRating(s.rows, new Date("2026-10-03T12:00:00"), 100),
  ]),
);

for (const scenario of scenarios) {
  const stats = byName.get(scenario.name);

  check(
    `typescript: ${scenario.name}`,
    {
      rating: stats.rating,
      paidGames: stats.paidGames,
      unpaidGames: stats.unpaidGames,
      label: stats.label,
    },
    scenario.expected,
  );
}

// The three ways a booking counts as settled, and the one way it does not.
check("settled: payment_status paid", bookingSettled(played()), true);
check(
  "settled: settled_at, even while pending",
  bookingSettled({ payment_status: "pending", paid_amount: 0, total_price: 1200, settled_at: "2026-09-22" }),
  true,
);
check(
  "settled: part payment is not settled",
  bookingSettled({ payment_status: "pending", paid_amount: 700, total_price: 1200, settled_at: null }),
  false,
);

// Trust moves on payment too: showing up while owing is worth less, and settling
// afterwards hands over the difference (3 + 5 = the 8 a paid-up game earns).
check("trust: paid-up completion", trustAfterComplete(90, true), 98);
check("trust: completion with a bill open", trustAfterComplete(90, false), 93);
check("trust: settling the bill afterwards", trustAfterPaid(93), 98);

/* ── the PHP half, through the real class ────────────────────────────────── */

function phpBinary() {
  if (process.env.PHP_BIN) return process.env.PHP_BIN;

  for (const candidate of ["php", phpWasm()]) {
    if (!candidate) continue;

    try {
      execFileSync(candidate, ["-v"], { stdio: "ignore" });
      return candidate;
    } catch {
      /* try the next one */
    }
  }

  return null;
}

/** php-wasm is what this sandbox has; it is opt-in via PHP_BIN. */
function phpWasm() {
  return process.env.PHP_WASM_BIN || null;
}

const runner = join(repoRoot, "laravel", "tests", "scripts", "loyalty-rate-json.php");
const php = phpBinary();

if (!php || !existsSync(runner)) {
  console.log(
    `\n  SKIP  the PHP half (no php binary${process.env.PHP_BIN ? "" : " found"} — set PHP_BIN to point at one)` +
      `\n        the TypeScript side above was still checked against the expected table`,
  );
} else {
  const tmp = join(appRoot, "scripts", ".tmp");
  mkdirSync(tmp, { recursive: true });
  const scenariosPath = join(tmp, "rating-scenarios.json");

  writeFileSync(
    scenariosPath,
    JSON.stringify(
      {
        now: NOW,
        trust: 100,
        scenarios: scenarios.map(({ name, rows }) => ({ name, rows })),
      },
      null,
      2,
    ),
  );

  const raw = execFileSync(php, [runner, scenariosPath], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  const { results } = JSON.parse(raw);

  for (const result of results) {
    const expected = scenarios.find((s) => s.name === result.name)?.expected;

    check(
      `php: ${result.name}`,
      {
        rating: result.rating,
        paidGames: result.paidGames,
        unpaidGames: result.unpaidGames,
        label: result.label,
      },
      expected,
    );
  }

  // Not just "both match the table" — the two implementations have to agree
  // with each other, field for field, on every scenario.
  const ts = scenarios.map((s) => {
    const stats = byName.get(s.name);

    return {
      name: s.name,
      rating: stats.rating,
      label: stats.label,
      emoji: stats.emoji,
      paidGames: stats.paidGames,
      unpaidGames: stats.unpaidGames,
      completed: stats.completed,
      cancelled: stats.cancelled,
      cancelsThisMonth: stats.cancelsThisMonth,
      trustScore: stats.trustScore,
    };
  });

  check(
    "php and typescript agree on every scenario, field for field",
    stripNames(results),
    stripNames(ts),
  );
}

/** The runner echoes the scenario name back; compare the rest. */
function stripNames(rows) {
  return rows.map(({ name, ...rest }) => rest);
}

console.log(
  failed === 0 ? `\nrating: all assertions passed\n` : `\nrating: ${failed} failed\n`,
);

process.exit(failed === 0 ? 0 : 1);
