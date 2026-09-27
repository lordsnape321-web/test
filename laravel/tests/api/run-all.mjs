/**
 * Run every live API suite against a running backend.
 *
 *   cd laravel/tests/api
 *   npm install
 *   BASE_URL=http://127.0.0.1:8000 npm test
 *
 * Six suites, from two places:
 *
 * - `ledger` and `settlement-lock` live here. They were ported from the Next.js
 *   app because they open a database connection of their own — to check the
 *   ledger's rows and to back-date `settled_at` so the five-minute lock can be
 *   tested without waiting. They talk to MySQL through `mysql.mjs`.
 *
 * - `gateway`, `venue-defaults`, `deposit-split` and `court-delete` are pure
 *   HTTP, so they are run from the Next.js app rather than copied. They are the
 *   same files that backend uses, which is the point: the two backends are
 *   being compared, not forked.
 *
 * `BASE_URL` is required in practice — it defaults to :3000, the Next.js port.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/** laravel/tests/api -> ../../../react-expo-laravel-futsal-app/tests/api */
const sharedDir = path.resolve(here, '..', '..', '..', 'react-expo-laravel-futsal-app', 'tests', 'api');

const SUITES = [
  { file: 'ledger.mjs', dir: here },
  { file: 'settlement-lock.mjs', dir: here },
  { file: 'gateway.mjs', dir: sharedDir },
  { file: 'venue-defaults.mjs', dir: sharedDir },
  { file: 'deposit-split.mjs', dir: sharedDir },
  { file: 'court-delete.mjs', dir: sharedDir },
];

const env = {
  ...process.env,
  BASE_URL: process.env.BASE_URL || 'http://127.0.0.1:8000',
};

if (!process.env.DATABASE_URL) {
  // Matches the .env.example defaults; override if your MySQL differs.
  env.DATABASE_URL = 'mysql://root@127.0.0.1:3306/futsal';
}

console.log(`\n— live API suites against ${env.BASE_URL} —`);
console.log(`   database: ${env.DATABASE_URL.replace(/:[^:@]*@/, ':****@')}`);

const results = [];

for (const suite of SUITES) {
  const full = path.join(suite.dir, suite.file);

  if (!existsSync(full)) {
    console.log(`\n⏭️  ${suite.file.padEnd(22)} SKIPPED — not found at ${full}`);
    results.push({ file: suite.file, passed: false, skipped: true });
    continue;
  }

  console.log(`\n──── ${suite.file} ────`);

  const r = spawnSync(process.execPath, [full], {
    cwd: suite.dir,
    env,
    stdio: 'inherit',
  });

  results.push({ file: suite.file, passed: r.status === 0 });
}

const skipped = results.filter((r) => r.skipped);
const failed = results.filter((r) => !r.passed && !r.skipped);
const passed = results.filter((r) => r.passed);

console.log(`\n════════════════════════════════════════`);
for (const r of results) {
  const mark = r.skipped ? '⏭️ ' : r.passed ? '✅' : '❌';
  console.log(`  ${mark}  ${r.file}`);
}
console.log(`════════════════════════════════════════`);
console.log(`${failed.length === 0 ? '✅' : '❌'}  ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped\n`);

process.exit(failed.length === 0 ? 0 : 1);
