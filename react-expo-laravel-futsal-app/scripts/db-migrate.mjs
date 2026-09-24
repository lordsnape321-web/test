#!/usr/bin/env node
/**
 * Small, idempotent production-safe compatibility migration.
 *
 * Drizzle's schema is the source of truth for a fresh database, but existing
 * deployments do not automatically run `drizzle-kit push` when the app starts.
 * The competition-consent and dedicated competition payment-policy columns are
 * additive, so apply just those changes here before Next starts serving
 * requests. `IF NOT EXISTS` makes this safe to run on every dev/start and safe
 * after a full db:push. Existing competition rows are backfilled from the
 * legacy charge_mode value once, while public custom pricing remains untouched.
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
      ADD COLUMN IF NOT EXISTS "competition_responded_at" timestamp,
      ADD COLUMN IF NOT EXISTS "competition_payment_policy" text;
    UPDATE "bookings"
    SET "competition_payment_policy" = CASE
      WHEN "charge_mode" = 'loser_pays' THEN 'loser_pays'
      ELSE 'split'
    END
    WHERE "visibility" = 'competition'
      AND "competition_payment_policy" IS NULL
  `);
  console.log("[db-migrate] competition booking columns and payment policy are ready");
} finally {
  await client.end();
}
