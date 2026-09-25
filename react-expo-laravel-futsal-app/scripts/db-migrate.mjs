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
      ADD COLUMN IF NOT EXISTS "competition_payment_policy" text,
      ADD COLUMN IF NOT EXISTS "advance_payment_required" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "advance_payment_amount" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "advance_payment_status" text NOT NULL DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS "advance_payment_requested_by" integer,
      ADD COLUMN IF NOT EXISTS "advance_payment_requested_at" timestamp;
    CREATE TABLE IF NOT EXISTS "booking_team_payments" (
      "id" serial PRIMARY KEY,
      "booking_id" integer NOT NULL,
      "team_id" integer NOT NULL,
      "user_id" integer NOT NULL,
      "amount_due" integer NOT NULL DEFAULT 0,
      "payment_method" text NOT NULL DEFAULT '',
      "payment_status" text NOT NULL DEFAULT 'pending',
      "paid_amount" integer NOT NULL DEFAULT 0,
      "gateway_txn_id" text NOT NULL DEFAULT '',
      "esewa_uuid" text NOT NULL DEFAULT '',
      "khalti_pidx" text NOT NULL DEFAULT '',
      "created_at" timestamp DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "booking_team_payments_booking_user_idx"
      ON "booking_team_payments" ("booking_id", "user_id");
    CREATE TABLE IF NOT EXISTS "booking_payment_requests" (
      "id" serial PRIMARY KEY,
      "booking_id" integer NOT NULL,
      "requested_by" integer NOT NULL,
      "payer_id" integer NOT NULL,
      "amount_due" integer NOT NULL DEFAULT 0,
      "purpose" text NOT NULL DEFAULT 'booking',
      "note" text NOT NULL DEFAULT '',
      "payment_method" text NOT NULL DEFAULT '',
      "status" text NOT NULL DEFAULT 'pending',
      "paid_amount" integer NOT NULL DEFAULT 0,
      "gateway_txn_id" text NOT NULL DEFAULT '',
      "esewa_uuid" text NOT NULL DEFAULT '',
      "khalti_pidx" text NOT NULL DEFAULT '',
      "created_at" timestamp DEFAULT now(),
      "paid_at" timestamp
    );
    CREATE INDEX IF NOT EXISTS "booking_payment_requests_booking_idx"
      ON "booking_payment_requests" ("booking_id");
    CREATE INDEX IF NOT EXISTS "booking_payment_requests_payer_idx"
      ON "booking_payment_requests" ("payer_id", "status");
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
