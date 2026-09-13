import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Connection string shared with the running app.
 *
 * This used to be a `drizzle.config.json` with the URL hard-coded, which meant
 * `npm run db:push` and the app (which reads `process.env.DATABASE_URL` in
 * `src/db/index.ts`) could silently point at *different* databases: the schema
 * would be pushed somewhere the app never reads, and every API route would 500
 * with `relation "..." does not exist`. One source of truth now — `.env`.
 *
 * The fallback keeps the starter working with the documented default local
 * Postgres (see README.md) when no `.env` has been created yet.
 */
const url =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: { url },
});
