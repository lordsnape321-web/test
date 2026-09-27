/**
 * A Postgres-shaped client over MySQL, for the ported API suites.
 *
 * Two of the six suites (`ledger`, `settlement-lock`) open a database
 * connection alongside their HTTP calls: they read `booking_payments` to prove
 * the API really wrote rows, and — more importantly — they back-date
 * `bookings.settled_at` so the five-minute settlement lock can be tested
 * without waiting five minutes. There is no HTTP route for either, and there
 * shouldn't be one.
 *
 * The originals speak `pg`. Rather than rewrite 300 lines of assertions, this
 * module presents the small slice of the `pg` client they use — `connect()`,
 * `query()`, `end()`, and `{ rows, rowCount }` — on top of `mysql2`, and
 * translates the handful of Postgres-isms in the SQL on the way through:
 *
 *   $1, $2 …      →  ?        (reordered to match, so repeats still work)
 *   interval '6 minutes'  →  interval 6 minute
 *   count(*)::int →  count(*)
 *
 * Everything else in those suites is plain SQL that both engines accept.
 *
 * Credentials come from Laravel's own `.env` (DB_HOST / DB_PORT / DB_DATABASE /
 * DB_USERNAME / DB_PASSWORD), so there is nothing to configure twice. A
 * `DATABASE_URL` in the environment wins, but only if it is a MySQL one — the
 * Next.js app exports a Postgres URL under that name, and picking it up here
 * would be the wrong database.
 */

import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const laravelEnv = path.resolve(here, '..', '..', '.env'); // laravel/.env

/** A deliberately small .env reader — just `KEY=value`, quotes optional. */
function readLaravelEnv() {
  let text;

  try {
    text = readFileSync(laravelEnv, 'utf8');
  } catch {
    return {};
  }

  const out = {};

  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);

    if (!m) {
      continue;
    }

    out[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
  }

  return out;
}

function dsnFromLaravelEnv() {
  const e = readLaravelEnv();

  const host = e.DB_HOST || '127.0.0.1';
  const port = e.DB_PORT || '3306';
  const database = e.DB_DATABASE || 'futsal';
  const user = e.DB_USERNAME || 'root';
  const password = e.DB_PASSWORD || '';

  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function resolveDsn() {
  const fromEnv = process.env.DATABASE_URL;

  // Ignore a Postgres URL: that is the other backend's variable, not ours.
  if (fromEnv && fromEnv.startsWith('mysql://')) {
    return fromEnv;
  }

  return dsnFromLaravelEnv();
}

function configFrom(dsn) {
  // Accept a URL; fall back to treating a bare name as the database name.
  if (!/^mysql:\/\//.test(dsn)) {
    return { host: '127.0.0.1', port: 3306, user: 'root', password: '', database: dsn };
  }

  const u = new URL(dsn);

  return {
    host: u.hostname || '127.0.0.1',
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username || 'root'),
    password: decodeURIComponent(u.password || ''),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}

/** `interval '6 minutes'` → `interval 6 minute`; `now()` is the same on both. */
function translate(sql) {
  return String(sql)
    .replace(/interval\s+'(\d+)\s+(\w+?)s?'/gi, (_m, n, unit) => `interval ${n} ${unit.toLowerCase()}`)
    .replace(/::\w+/g, '');
}

/**
 * MySQL hands back DECIMAL and BIGINT columns as strings ("1700"), where pg
 * hands back numbers. The suites assert `amount === 700`, so anything the wire
 * sent as a numeric type is put back into a JS number — using the column type
 * mysql2 reports, so a genuinely textual value is left alone.
 */
const NUMERIC_TYPES = new Set([0, 1, 2, 3, 4, 5, 8, 9, 246]); // DECIMAL … NEWDECIMAL

function coerce(row, fields) {
  const out = {};

  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') {
      out[key] = Number(value);
      continue;
    }

    if (typeof value === 'string' && fields?.length) {
      const field = fields.find((f) => f.name === key);

      if (field && NUMERIC_TYPES.has(field.columnType) && /^-?\d+(\.\d+)?$/.test(value)) {
        out[key] = Number(value);
        continue;
      }
    }

    out[key] = value;
  }

  return out;
}

export class Client {
  constructor(connectionString) {
    this.connectionString = connectionString || resolveDsn();
    this.conn = null;
  }

  /** Where we ended up connecting, with the password masked. */
  describe() {
    const c = configFrom(this.connectionString);

    return `mysql://${c.user}:****@${c.host}:${c.port}/${c.database}`;
  }

  async connect() {
    this.conn = await mysql.createConnection(configFrom(this.connectionString));

    return this;
  }

  async query(sql, params = []) {
    if (!this.conn) {
      throw new Error('query() before connect()');
    }

    const text = translate(sql);

    // `$1`-style placeholders may repeat and arrive out of order, so rebuild the
    // parameter list in the order the `?`s now appear.
    const positions = [...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    const statement = text.replace(/\$(\d+)/g, '?');
    const ordered = positions.length ? positions.map((i) => params[i - 1]) : params;

    const [result, fields] = await this.conn.query(statement, ordered);

    // mysql2 hands back a ResultSetHeader for writes and an array for reads;
    // pg always hands back `{ rows, rowCount }`.
    if (Array.isArray(result)) {
      const rows = result.map((row) => coerce(row, fields));

      return { rows, rowCount: rows.length, fields: fields ?? [] };
    }

    return { rows: [], rowCount: result.affectedRows ?? 0, insertId: result.insertId };
  }

  async end() {
    if (this.conn) {
      await this.conn.end();
      this.conn = null;
    }
  }
}

export default { Client };
