import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);

/**
 * Additive compatibility migration for deployments that already existed before
 * competition consent and its dedicated payment policy were introduced.
 * `drizzle-kit push` is still the normal schema workflow, but API requests also
 * call this once so an old production database cannot fail every booking query
 * just because the app was deployed before its migration command ran. Legacy
 * competition policies are copied out of charge_mode; public custom pricing is
 * never changed.
 */
let competitionColumnsReady: Promise<void> | null = null;

export function ensureCompetitionBookingColumns(): Promise<void> {
  if (!competitionColumnsReady) {
    competitionColumnsReady = pool
      .query(`
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
        UPDATE "bookings"
        SET "competition_payment_policy" = CASE
          WHEN "charge_mode" = 'loser_pays' THEN 'loser_pays'
          ELSE 'split'
        END
        WHERE "visibility" = 'competition'
          AND "competition_payment_policy" IS NULL;
      `)
      .then(() => undefined)
      .catch((error) => {
        // Allow a later request to retry if the database was briefly starting.
        competitionColumnsReady = null;
        throw error;
      });
  }
  return competitionColumnsReady;
}
