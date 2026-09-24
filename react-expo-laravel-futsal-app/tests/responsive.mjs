import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Static responsive guardrails 📱
 *
 * This sandbox has no browser binary, so real-device rendering cannot be
 * measured here. What CAN be checked is the handful of patterns that provably
 * break a narrow viewport — each one below was found in this codebase and
 * fixed, and each would silently come back on the next refactor.
 *
 * These are deliberately narrow. A blunt "every truncate needs min-w-0" rule
 * flags 90+ false positives, because `truncate` only needs it when the element
 * is itself a shrinkable grid/flex item.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

let pass = 0, fail = 0;
const ok = (n, c, e = "") => {
  c ? (pass++, console.log("  PASS  " + n)) : (fail++, console.log("  FAIL  " + n + (e ? "  → " + e : "")));
};

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts|css)$/.test(p)) out.push(p);
  }
  return out;
}

const files = walk(src);
const read = (p) => readFileSync(p, "utf8");
const rel = (p) => relative(join(here, ".."), p);

console.log("\n— the viewport is configured for mobile —");
const layout = read(join(src, "app", "layout.tsx"));
ok("the root layout declares a viewport export", /export const viewport\b/.test(layout));
ok("it sets viewport-fit: cover, without which env(safe-area-inset-*) is 0",
   /viewportFit:\s*["']cover["']/.test(layout),
   "the bottom nav's pb-[env(safe-area-inset-bottom)] would collapse to nothing");
ok("it declares a theme colour", /themeColor/.test(layout));

console.log("\n— no element is pinned wider than a phone —");
// A fixed pixel width at or above the narrowest common viewport (320px, minus
// the usual 16px gutters) cannot shrink and forces horizontal scrolling.
// `max-w-[…]` is fine — it caps instead of pins — and so is anything behind a
// breakpoint prefix: `sm:w-[330px]` only applies from 640px up, where 330px is
// comfortable. The lookbehind excludes a preceding letter, `-` or `:` so those
// two shapes are skipped.
const tooWide = [];
for (const f of files) {
  const s = read(f);
  for (const m of s.matchAll(/(?<![a-zA-Z:-])w-\[(\d+)px\]/g)) {
    const px = Number(m[1]);
    if (px >= 300) {
      const line = s.slice(0, m.index).split("\n").length;
      tooWide.push(`${rel(f)}:${line} w-[${px}px]`);
    }
  }
}
ok("no w-[Npx] at or above 300px", tooWide.length === 0, tooWide.join(", "));

console.log("\n— wide tables scroll instead of overflowing the page —");
const badTables = [];
for (const f of files.filter((f) => f.endsWith(".tsx"))) {
  const s = read(f);
  if (!/<table/.test(s)) continue;
  // A table that pins a min-width must sit in an overflow-x-auto wrapper.
  const pinsWidth = /<table[^>]*min-w-\[\d+px\]/.test(s);
  if (pinsWidth && !/overflow-x-auto/.test(s)) badTables.push(rel(f));
}
ok("every min-width table has an overflow-x-auto wrapper", badTables.length === 0, badTables.join(", "));

console.log("\n— grid cells that truncate can actually shrink —");
// Only flags the specific shape that breaks: a grid container whose direct
// cells use `truncate` but have no min-w-0. Grid items default to
// min-width:auto, so the text widens the track instead of ellipsising.
const badCells = [];
for (const f of files.filter((f) => f.endsWith(".tsx"))) {
  const s = read(f);
  for (const m of s.matchAll(/<div className="[^"]*\bgrid grid-cols-\d[^"]*">/g)) {
    // Look at the next ~700 chars — the container's immediate cells.
    const region = s.slice(m.index, m.index + 700);
    for (const cell of region.matchAll(/<div className="([^"]*)">/g)) {
      const cls = cell[1];
      if (/truncate/.test(cls) && !/min-w-0/.test(cls)) {
        const line = s.slice(0, m.index).split("\n").length;
        badCells.push(`${rel(f)}:${line}`);
        break;
      }
    }
  }
}
ok("grid cells using truncate also carry min-w-0", badCells.length === 0, badCells.join(", "));

console.log("\n— the dark backdrop matches Owner Studio —");
const css = read(join(src, "app", "globals.css"));
ok("dark body is slate-950 (#020617), not warm stone-950", /\.dark body\s*\{[^}]*#020617/.test(css));
ok("the warm near-black (#0c0a09) is gone from dark mode", !/#0c0a09/.test(css));
ok("dark mode has no dot texture", !/\.dark \.turf-pattern\s*\{[^}]*1\.2px/.test(css));
ok("light mode keeps its dot texture", /\.turf-pattern\s*\{[^}]*1\.2px/.test(css));

console.log("\n— iOS can't zoom the page when a field is focused —");
// iOS Safari force-zooms on focus when a field's font-size is under 16px. Most
// form controls here are text-sm/text-xs, so a global rule handles all ~157 of
// them at once. It must stay unlayered, or Tailwind's utilities win.
const zoomRule = /@media \(max-width: 640px\)\s*\{[^}]*input:not\(\[type="checkbox"\][\s\S]*?font-size:\s*16px/;
ok("form controls are bumped to 16px at phone widths", zoomRule.test(css),
   "iOS will zoom the whole page on every input focus");
ok("checkbox/radio/range are excluded from the bump",
   /\[type="checkbox"\][\s\S]*?\[type="radio"\][\s\S]*?\[type="range"\]/.test(css));

console.log("\n— no dark-mode warm neutrals crept back in —");
const darkStone = [];
for (const f of files) {
  const s = read(f);
  const hits = s.match(/dark:[^\s"']*stone-\d+/g);
  if (hits) darkStone.push(`${rel(f)} (${hits.length})`);
}
ok("no dark:*stone-* utilities remain", darkStone.length === 0, darkStone.join(", "));

console.log(fail === 0 ? `\nALL PASS (${pass}/${pass})` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
