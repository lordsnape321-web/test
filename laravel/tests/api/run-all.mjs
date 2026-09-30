/**
 * Run every live API suite against a running backend.
 *
 *   cd laravel/tests/api
 *   npm install
 *   BASE_URL=http://127.0.0.1:8000 npm test
 *
 * All suites live in this directory so the Laravel API tests are
 * self-contained. The ledger suites and `email.mjs` open a database connection
 * through `mysql.mjs`; the rest — including `batch.mjs`, which checks the
 * batched-read endpoint — exercise the HTTP contract only.
 *
 * `BASE_URL` defaults to Laravel's local port, `:8000`.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

const SUITES = [
  'ledger.mjs',
  'settlement-lock.mjs',
  'gateway.mjs',
  'venue-defaults.mjs',
  'deposit-split.mjs',
  'court-delete.mjs',
  'email.mjs',
  'batch.mjs',
].map((file) => ({ file, dir: here }));

const env = {
  ...process.env,
  BASE_URL: process.env.BASE_URL || 'http://127.0.0.1:8000',
};

// The Laravel runner reads DB_* from laravel/.env. Never inherit a stale
// DATABASE_URL from another project or accidentally point these tests at a
// PostgreSQL database.
delete env.DATABASE_URL;

const { Client } = await import('./mysql.mjs');

console.log(`\n— live API suites against ${env.BASE_URL} —`);
console.log(`   database: ${new Client().describe()}   (from laravel/.env)`);

/*
 * Fail fast, and say why. Without this, a server that isn't up produces four
 * identical ECONNREFUSED stack traces and nothing that points at the cause.
 */
try {
  const res = await fetch(`${env.BASE_URL}/api/health`, { signal: AbortSignal.timeout(5000) });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`/api/health answered ${res.status}: ${body.error || body.message || 'no error body'}`);
  }
} catch (err) {
  console.error(`\n❌  nothing answered at ${env.BASE_URL}/api/health — ${err.message}`);
  console.error(`    start the backend first:  cd laravel && php artisan serve\n`);
  process.exit(1);
}

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
