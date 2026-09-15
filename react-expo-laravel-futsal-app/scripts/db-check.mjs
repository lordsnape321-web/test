#!/usr/bin/env node
/**
 * Diagnose the "every API route returns 500" class of problem.
 *
 *   npm run db:check
 *
 * Reports, in order: which DATABASE_URL is in play, whether Postgres is
 * reachable, whether auth succeeded, whether the target database exists, and
 * whether the schema has been pushed. Ends with the exact command to fix
 * whatever is missing. Exits non-zero when the app would not work.
 */
import "dotenv/config";
import pg from "pg";

const { Client } = pg;

/** The tables declared in src/db/schema.ts. */
const EXPECTED = [
  "users",
  "venues",
  "courts",
  "bookings",
  "teams",
  "team_members",
  "team_requests",
  "team_invites",
  "open_matches",
  "match_joins",
  "notifications",
  "vouchers",
  "promos",
  "reviews",
];

const url =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

/** Show the URL without leaking the password into a terminal someone screenshots. */
function mask(u) {
  return u.replace(/\/\/([^:/@]+):([^@]+)@/, (_m, user, pass) =>
    `//${user}:${"*".repeat(Math.min(pass.length, 8))}@`
  );
}

function parts(u) {
  const m = u.match(/^postgres(?:ql)?:\/\/(?:[^:@/]+(?::[^@/]*)?@)?([^:/?]+)(?::(\d+))?\/([^?]*)/);
  return m ? { host: m[1], port: m[2] ?? "5432", db: m[3] } : null;
}

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const note = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const hint = (lines) => {
  console.log("\n\x1b[1mNext step:\x1b[0m");
  for (const l of lines) console.log(`  ${l}`);
  console.log();
};

console.log("\n\x1b[1mDatabase check\x1b[0m");
console.log(`  DATABASE_URL: ${mask(url)}`);
if (!process.env.DATABASE_URL) note("not set in the environment — using the built-in default (is .env present?)");

const p = parts(url);
if (!p) {
  bad("DATABASE_URL is not a parseable postgres:// URL");
  process.exit(1);
}

// 1. Can we reach the server and authenticate against the target database?
const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
} catch (e) {
  const msg = String(e.message ?? e);
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/.test(msg)) {
    bad(`no Postgres listening on ${p.host}:${p.port}`);
    hint([
      "Start Postgres, either with Docker:",
      `  docker run --name futsal-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=${p.db} -p ${p.port}:5432 -d postgres:16`,
      "or, if Postgres is installed locally:",
      "  sudo service postgresql start",
      "Then re-run:  npm run db:check",
    ]);
  } else if (/does not exist/.test(msg)) {
    bad(`server is reachable but database "${p.db}" does not exist`);
    hint([
      "Create the database, then push the schema:",
      `  docker exec -it futsal-pg psql -U postgres -c 'CREATE DATABASE ${p.db}'`,
      "  (or: sudo -u postgres createdb " + p.db + ")",
      "  npm run db:push",
    ]);
  } else if (/authentication|password/i.test(msg)) {
    bad(`authentication failed for the user/password in DATABASE_URL`);
    hint([
      `  ${msg}`,
      "",
      "Good news: Postgres IS running and reachable — only the credentials were rejected.",
      "",
      "On Debian/Ubuntu/Parrot/Kali the postgres role is created for *peer* auth over the",
      "Unix socket with no password, so every TCP connection to 127.0.0.1 fails until you",
      "set one. Fix it with peer auth (no password needed, hence the sudo):",
      "  sudo -u postgres psql -c \"ALTER USER postgres PASSWORD 'postgres'\"",
      "",
      "Then make sure the database exists and push the schema:",
      `  sudo -u postgres createdb ${p.db}`,
      "  npm run db:check && npm run db:push",
      "",
      "Prefer not to use the superuser? Create a dedicated role instead and point .env at it:",
      "  sudo -u postgres psql -c \"CREATE USER futsal WITH PASSWORD 'futsal'\"",
      `  sudo -u postgres psql -c "CREATE DATABASE ${p.db} OWNER futsal"`,
      `  echo 'DATABASE_URL=postgresql://futsal:futsal@${p.host}:${p.port}/${p.db}' > .env`,
      "",
      "Already know the real password? Put it in .env instead — percent-encode any of",
      "  : / @ # ? & =  (e.g. p@ss -> p%40ss), or the URL parses incorrectly.",
    ]);
  } else {
    bad(`could not connect: ${msg}`);
  }
  process.exit(1);
}
ok(`connected to ${p.host}:${p.port}/${p.db}`);

// 2. Has the schema been pushed?
const { rows } = await client.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
);
const present = new Set(rows.map((r) => r.table_name));
const missing = EXPECTED.filter((t) => !present.has(t));

if (missing.length === EXPECTED.length) {
  bad(`database is empty — none of the ${EXPECTED.length} tables exist`);
  await client.end();
  hint(["Push the schema, then seed demo data:", "  npm run db:push", "  npm run dev   # then POST /api/seed (the home page has a Seed demo data button)"]);
  process.exit(1);
}
if (missing.length > 0) {
  note(`schema is partially pushed — missing: ${missing.join(", ")}`);
  await client.end();
  hint(["Re-push to apply the missing tables:", "  npm run db:push"]);
  process.exit(1);
}
ok(`all ${EXPECTED.length} tables present`);

// 3. Is there any data to render?
const counts = {};
for (const t of ["users", "venues", "courts", "promos", "bookings"]) {
  const r = await client.query(`SELECT count(*)::int AS n FROM "${t}"`);
  counts[t] = r.rows[0].n;
}
await client.end();
console.log(`  rows: ${Object.entries(counts).map(([t, n]) => `${t}=${n}`).join("  ")}`);
if (counts.venues === 0) {
  note("schema is fine but the database has no demo data");
  hint(["Start the app and seed it:", "  npm run dev", "  curl -X POST http://localhost:3000/api/seed"]);
} else {
  ok("ready — the app should render data");
}
console.log();
