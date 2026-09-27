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
 */

import mysql from 'mysql2/promise';

const DSN = process.env.DATABASE_URL || 'mysql://root@127.0.0.1:3306/futsal';

function configFrom(dsn) {
  // Accept a URL; fall back to treating a bare host as a local socket user.
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
  constructor(_connectionString) {
    this.connectionString = _connectionString || DSN;
    this.conn = null;
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
