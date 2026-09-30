/**
 * The read batcher in `src/lib/api.ts`, against a mock API that counts requests.
 *
 *   npx esbuild scripts/batch.test.mjs --bundle --platform=node --format=esm \
 *     --outfile=scripts/.tmp/batch.mjs && node scripts/.tmp/batch.mjs
 *
 * Plain `.mjs`, not `.ts`: it needs `node:http`, and the app's tsconfig has no
 * node types (the app itself is React Native).
 *
 * What it proves: the reads a screen fires together leave as **one** HTTP
 * request, the same path twice is asked once, a lone read is still a plain
 * request, a failure inside a batch still arrives as the screen's usual
 * ApiError, writes are never batched, and a backend without the batch route
 * degrades to one request per read instead of breaking.
 */

import http from "node:http";

const assert = {
  equal(actual, expected, what = "value") {
    if (actual !== expected) {
      throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  ok(condition, what = "condition") {
    if (!condition) throw new Error(`${what}: expected truthy, got ${JSON.stringify(condition)}`);
  },
};

const PORT = 8791;
process.env.EXPO_PUBLIC_API_BASE = `http://127.0.0.1:${PORT}`;

let hits = [];
let batchAvailable = true;

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const url = String(req.url ?? "");
    const path = url.split("?")[0];

    res.setHeader("Content-Type", "application/json");

    if (path === "/api/batch") {
      hits.push({ method: req.method ?? "", path, body: raw });

      if (!batchAvailable) {
        // What an older backend (or a proxy that drops POST) would answer.
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      const parsed = JSON.parse(raw || "{}");
      const responses = (parsed.requests ?? []).map((item) => {
        const sub = String(item?.path ?? "");

        // One endpoint that says no, so an item-level failure can be checked.
        if (sub.includes("boom")) {
          return { status: 422, body: { error: "That court is already booked for this slot" } };
        }

        return { status: 200, body: { path: sub, ok: true } };
      });

      res.end(JSON.stringify({ responses }));
      return;
    }

    hits.push({ method: req.method ?? "", path, body: raw });

    if (path.includes("boom")) {
      res.statusCode = 422;
      res.end(JSON.stringify({ error: "That court is already booked for this slot" }));
      return;
    }

    res.end(JSON.stringify({ path: url, ok: true }));
  });
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve()));

// Imported after the base URL is set: the module reads it once, at load.
const { apiJson, ApiError } = await import("../src/lib/api");

/* ── reads in one tick are one request ───────────────────────────────────── */

hits = [];
const [venues, courts, venuesAgain] = await Promise.all([
  apiJson("/api/venues"),
  apiJson("/api/courts?venueId=3"),
  apiJson("/api/venues"),
]);

assert.equal(hits.length, 1, "HTTP requests for three reads");
assert.equal(hits[0].path, "/api/batch", "the one request is the batch route");
assert.equal(hits[0].method, "POST", "batch method");

const sent = JSON.parse(hits[0].body).requests.map((r) => r.path);
assert.equal(sent.length, 2, "reads sent (the duplicate path is asked once)");
assert.equal(sent[0], "/api/venues", "first read");
assert.equal(sent[1], "/api/courts?venueId=3", "second read");

assert.equal(venues.path, "/api/venues", "first read resolved with its own body");
assert.equal(courts.path, "/api/courts?venueId=3", "second read resolved with its own body");
assert.equal(venuesAgain.ok, true, "the duplicate read resolved too");

/* ── a lone read is still a plain request ────────────────────────────────── */

hits = [];
const single = await apiJson("/api/stats");
assert.equal(hits.length, 1, "HTTP requests for one read");
assert.equal(hits[0].path, "/api/stats", "read sent directly, not through the batch");
assert.equal(single.path, "/api/stats", "single read resolved");

/* ── a failure inside a batch arrives as the usual ApiError ──────────────── */

hits = [];
const outcomes = await Promise.all([
  apiJson("/api/venues/boom").then(
    () => "resolved",
    (e) => e,
  ),
  apiJson("/api/courts"),
]);

const failure = outcomes[0];
assert.ok(failure instanceof ApiError, "failed read rejected with ApiError");
assert.equal(failure.status, 422, "status carried through");
assert.equal(failure.message, "That court is already booked for this slot", "server message carried through");
assert.equal(outcomes[1].ok, true, "its neighbour in the batch still resolved");
assert.equal(hits.length, 1, "the batch was still one request");

/* ── writes are never batched ────────────────────────────────────────────── */

hits = [];
await apiJson("/api/bookings", { method: "POST", json: { courtId: 3 } });
assert.equal(hits.length, 1, "HTTP requests for a write");
assert.equal(hits[0].path, "/api/bookings", "write went straight to its route");
assert.equal(hits[0].method, "POST", "write kept its method");

/* ── no batch route: fall back, then stop trying ─────────────────────────── */

batchAvailable = false;
hits = [];
const [a, b] = await Promise.all([
  apiJson("/api/venues"),
  apiJson("/api/courts"),
]);

const batchAttempts = hits.filter((h) => h.path === "/api/batch").length;
const individual = hits.filter((h) => h.path !== "/api/batch").length;
assert.equal(batchAttempts, 1, "one attempt at the batch route");
assert.equal(individual, 2, "both reads re-issued individually");
assert.ok(a.ok && b.ok, "both reads still resolved");

// And with the batch route known bad, later reads don't even try it.
hits = [];
await Promise.all([apiJson("/api/venues"), apiJson("/api/stats")]);
assert.equal(hits.filter((h) => h.path === "/api/batch").length, 0, "no further batch attempts");
assert.equal(hits.length, 2, "both later reads went out individually");

server.close();
console.log("batch: all assertions passed");
