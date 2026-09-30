/**
 * The card/hero image sizer in `src/lib/images.ts`.
 *
 *   npx esbuild scripts/images.test.ts --bundle --platform=node --format=esm \
 *     --tsconfig=tsconfig.json --outfile=scripts/.tmp/images.mjs && node scripts/.tmp/images.mjs
 *
 * The point is that a 192px-tall card was downloading a 1200px photo, and that
 * "shrink it" must never mean "break it" for a URL we do not own.
 */

const assert = {
  equal(actual: unknown, expected: unknown, what = "value") {
    if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
};

import { CARD_IMAGE_WIDTH, HERO_IMAGE_WIDTH, sizedImage } from "../src/lib/images";

/* ── the bytes actually saved ───────────────────────────────────────────── */

const stored = "https://images.unsplash.com/photo-1574629810360-7efbbe195018?q=80&w=1200&auto=format&fit=crop";
const card = sizedImage(stored, CARD_IMAGE_WIDTH);

assert.equal(card.includes("w=720"), true, "a card asks for 720px");
assert.equal(card.includes("w=1200"), false, "and no longer for 1200px");
assert.equal(card.includes("q=80"), true, "quality is preserved");
assert.equal(card.includes("auto=format"), true, "format negotiation is preserved");
assert.equal(card.includes("fit=crop"), true, "the crop is preserved");

assert.equal(sizedImage(stored, HERO_IMAGE_WIDTH), stored, "a hero keeps the original size");

/* ── never upscale ──────────────────────────────────────────────────────── */

const small = "https://images.unsplash.com/photo-1?w=400";
assert.equal(sizedImage(small, CARD_IMAGE_WIDTH), small, "a small source is left alone");

/* ── someone else's URL is not ours to rewrite ──────────────────────────── */

const foreign = "https://cdn.example.com/turf.jpg?w=1200";
assert.equal(sizedImage(foreign, CARD_IMAGE_WIDTH), foreign, "non-Unsplash URLs pass through untouched");
assert.equal(
  sizedImage("https://example.com/images.unsplash.com/photo.jpg", 100),
  "https://example.com/images.unsplash.com/photo.jpg",
  "a lookalike host is not treated as Unsplash",
);

/* ── missing images stay missing, so the caller's guard still works ─────── */

assert.equal(sizedImage(null, CARD_IMAGE_WIDTH), "", "null becomes an empty string");
assert.equal(sizedImage(undefined, CARD_IMAGE_WIDTH), "", "undefined becomes an empty string");
assert.equal(sizedImage("   ", CARD_IMAGE_WIDTH), "", "whitespace becomes an empty string");
assert.equal(Boolean(sizedImage(null, CARD_IMAGE_WIDTH)), false, "and stays falsy for `x ? <Image/> : null`");

/* ── junk does not throw ────────────────────────────────────────────────── */

assert.equal(sizedImage("not a url", CARD_IMAGE_WIDTH), "not a url", "an unparseable value is returned as-is");

console.log("images: all assertions passed");
