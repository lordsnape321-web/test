#!/usr/bin/env node
/**
 * Runs the futsal test suites 🧪
 *
 * There is no test framework in this project, so this is deliberately small: the
 * `.tsx` suites are bundled with esbuild (already a Next.js dependency) into a
 * temp file and run with node, and the `tests/api/*.mjs` suites are plain node
 * scripts that talk to a running dev server.
 *
 *   node tests/run.mjs            # unit + DOM  (no server needed)
 *   node tests/run.mjs --api      # the live API suites (needs `npm run dev` + a DB)
 *   node tests/run.mjs --all
 *
 * The API suites create their own venues, courts and bookings, so they need
 * players with cancellation headroom — see PLAYER/P1/P2/P3 below.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { allocatePlayers, cancelHeadroom, ensureFreshPlayers } from "./players.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const app = dirname(here);
const args = process.argv.slice(2);
const wantApi = args.includes("--api") || args.includes("--all");
const wantOffline = !args.includes("--api") || args.includes("--all");

const ESBUILD = join(app, "node_modules", ".bin", "esbuild");
// Bundles have to be written *inside* the app: the suites mark `jsdom` as
// external, and node resolves that from the importing file's directory. A
// bundle in /tmp cannot see node_modules and dies with ERR_MODULE_NOT_FOUND.
const work = join(here, ".tmp");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const results = [];

/** Bundle a .tsx suite against src/ and run it. */
function runTsx(file) {
  const out = join(work, file.replace(/\.tsx$/, ".mjs"));
  execFileSync(
    ESBUILD,
    [
      join(here, file),
      "--bundle",
      "--format=esm",
      "--platform=node",
      "--alias:@=./src",
      "--jsx=automatic",
      "--loader:.tsx=tsx",
      "--external:jsdom",
      `--outfile=${out}`,
      "--log-level=warning",
    ],
    { cwd: app, stdio: ["ignore", "ignore", "inherit"] }
  );
  const r = spawnSync(process.execPath, [out], { cwd: app, encoding: "utf8" });
  report(file, r);
}

/** Run a plain node suite. */
function runMjs(file, env = {}) {
  const r = spawnSync(process.execPath, [join(here, "api", file)], {
    cwd: app,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  report(`api/${file}`, r);
}

function report(name, r) {
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const line = out.trim().split("\n").filter(Boolean).slice(-1)[0] ?? "";
  const passed = r.status === 0;
  results.push({ name, passed, line });
  const body = out
    .split("\n")
    .filter((l) => /PASS|FAIL|—/.test(l))
    .join("\n");
  if (!passed || process.env.VERBOSE) console.log(body);
  console.log(`${passed ? "✅" : "❌"} ${name.padEnd(26)} ${line}`);
}

if (wantOffline) {
  console.log("\n— pure logic + rendered components (no server) —");
  for (const f of readdirSync(here).filter((f) => f.endsWith(".tsx")).sort()) runTsx(f);
}

/**
 * The live suites and how many cancellations each player slot will cause.
 * The app caps a player at 3 cancellations a month, so the runner asks the
 * database who still has room and hands out distinct players — guessing ids
 * made a later suite trip "Whoa, slow down! 🛑" and cascade into failures
 * that had nothing to do with the code under test.
 */
const API_SUITES = [
  { file: "ledger.mjs", slots: { PLAYER: 0, PLAYER2: 0 } },
  { file: "gateway.mjs", slots: { G1: 0, G2: 0 } },
  { file: "venue-defaults.mjs", slots: { V1: 0 } },
  { file: "settlement-lock.mjs", slots: { P1: 0, P2: 0, P3: 1 } },
  { file: "deposit-split.mjs", slots: { D1: 2 } },
  { file: "court-delete.mjs", slots: { U: 2 } },
];

async function runApi() {
  console.log("\n— live API (needs `npm run dev` and a database) —");

  const dsn = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
  const base = process.env.BASE_URL || "http://127.0.0.1:3000";
  let assigned = new Map();
  try {
    const byUser = await cancelHeadroom(dsn);
    // Minted accounts keep the run repeatable: seeded players permanently
    // accrue cancellations, so after a few runs none of them can book.
    for (const line of await ensureFreshPlayers(base, API_SUITES, byUser)) {
      console.log(`   · ${line}`);
    }
    const { env, problems, plan } = allocatePlayers(API_SUITES, byUser);
    assigned = env;
    for (const line of plan) console.log(`   · ${line}`);
    for (const problem of problems) {
      // Only reachable if minting above failed, because a freshly registered
      // account always has the full allowance. Note that `POST /api/seed` is
      // NOT a remedy: it returns early when the venues table is non-empty, so
      // on a database that already has data it changes nothing.
      console.log(`   ⚠️  ${problem}`);
      console.log("      Signing up a fresh player did not work — is the dev server up?");
      console.log("      Allowances also reset on their own on the 1st of each month.");
    }
  } catch (err) {
    console.log(`   ⚠️  could not read the database to pick players (${err.message});`);
    console.log("      falling back to each suite's built-in defaults.");
  }

  for (const suite of API_SUITES) {
    const suiteEnv = assigned.get(suite.file) ?? {};
    const missing = Object.keys(suite.slots).filter((slot) => !suiteEnv[slot]);
    if (missing.length) {
      results.push({
        name: `api/${suite.file}`,
        passed: false,
        line: `SKIPPED — no player for ${missing.join(", ")}`,
      });
      console.log(`⏭️  api/${suite.file.padEnd(22)} SKIPPED — no player for ${missing.join(", ")}`);
      continue;
    }
    runMjs(suite.file, suiteEnv);
  }
}

if (wantApi) await runApi();

rmSync(work, { recursive: true, force: true });

const failed = results.filter((r) => !r.passed);
const total = results.length;
console.log(
  `\n${failed.length === 0 ? "✅" : "❌"} ${total - failed.length}/${total} suites passed`
);
process.exit(failed.length === 0 ? 0 : 1);
