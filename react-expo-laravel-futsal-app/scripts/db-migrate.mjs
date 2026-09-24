#!/usr/bin/env node
/**
 * Small, idempotent production-safe compatibility migration.
 *
 * Drizzle's schema is the source of truth for a fresh database, but existing
 * deployments do not automatically run `drizzle-kit push` when the app starts.
 * The competition-consent columns are additive, so apply just that additive
 * change here before Next starts serving requests. `IF NOT EXISTS` makes this
 * safe to run on every dev/start and safe after a full db:push.
 */
import "dotenv/config";
import pg from "pg";

const { Client } = pg;
const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL is required to run the database migration");
}

const client = new Client({ connectionString: url });
await client.connect();
try {
  await client.query(`
    ALTER TABLE "bookings"
      ADD COLUMN IF NOT EXISTS "competition_status" text NOT NULL DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS "competition_responded_by" integer,
      ADD COLUMN IF NOT EXISTS "competition_responded_at" timestamp
  `);
  console.log("[db-migrate] competition booking columns are ready");
} finally {
  await client.end();
}
