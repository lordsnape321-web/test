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
          ADD COLUMN IF NOT EXISTS "competition_payment_policy" text;
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
