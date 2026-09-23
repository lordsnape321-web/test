/**
 * Portability guardrails for the Expo + Laravel migration.
 *
 * The plan is to carry this codebase to a React Native (Expo) frontend with a
 * Laravel backend. Two properties make that mechanical, and both are easy to
 * erode one innocent-looking line at a time:
 *
 *   1. Every network call goes through src/lib/api.ts, so the backend origin is
 *      one environment variable. React Native has no origin — a relative URL is
 *      not a valid URL there — and Laravel is a separate host.
 *   2. Client-side persistence goes through src/lib/storage.ts, because React
 *      Native has no localStorage (it has AsyncStorage).
 *
 * These are static source scans; nothing here renders or requests anything.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  → " + extra : "")); }
};

const root = new URL("../src", import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

const files = walk(root).map((f) => ({
  rel: f.slice(root.length + 1),
  text: readFileSync(f, "utf8"),
}));

console.log("\n— every network call is origin-configurable —");

// A relative fetch works on web and fails in React Native.
const SEAM = "lib/api.ts";
const raw = [];
for (const { rel, text } of files) {
  if (rel === SEAM) continue;   // the seam documents an example fetch of its own
  text.split("\n").forEach((line, i) => {
    if (/(?<![a-zA-Z])fetch\(\s*[`"']\/api\//.test(line)) raw.push(`${rel}:${i + 1}`);
  });
}
ok("no component hardcodes a relative fetch(\"/api/…\")", raw.length === 0, raw.slice(0, 5).join(", "));

const users = files.filter((f) => /\bapiFetch\(/.test(f.text));
ok("apiFetch is actually in use", users.length > 30, `${users.length} files`);
const missing = users.filter((f) => f.rel !== SEAM && !f.text.includes('from "@/lib/api"')).map((f) => f.rel);
ok("every apiFetch caller imports it from @/lib/api", missing.length === 0, missing.join(", "));

const api = files.find((f) => f.rel === "lib/api.ts");
ok("src/lib/api.ts exists", !!api);
if (api) {
  ok("the base is read from NEXT_PUBLIC_API_BASE",
     /process\.env\.NEXT_PUBLIC_API_BASE/.test(api.text),
     "a non-public var is not inlined into the client bundle");
  ok("an already-absolute url is never prefixed",
     /\^\[?https\?:|https\?:\\?\/\\?\//i.test(api.text),
     "otherwise base+base+path");
}

console.log("\n— client-side persistence has one swap point —");

// React Native has no localStorage; AsyncStorage is the equivalent.
const ALLOWED = new Set(["lib/storage.ts", "app/layout.tsx"]);
const stray = [];
for (const { rel, text } of files) {
  if (ALLOWED.has(rel)) continue;
  text.split("\n").forEach((line, i) => {
    if (/\b(localStorage|sessionStorage)\./.test(line)) stray.push(`${rel}:${i + 1}`);
  });
}
ok("no component touches localStorage directly", stray.length === 0, stray.slice(0, 5).join(", "));

const st = files.find((f) => f.rel === "lib/storage.ts");
ok("src/lib/storage.ts exists", !!st);
if (st) {
  ok("it degrades safely where localStorage is unavailable",
     /typeof localStorage !== "undefined"/.test(st.text) && /catch/.test(st.text));
  ok("it exposes a hydrate hook for AsyncStorage", /hydrate\s*\(/.test(st.text),
     "AsyncStorage is async, so the RN port must seed it at startup");
}

// app/layout.tsx is allowed an inline pre-hydration script, but it must stay
// defensive: it runs before React and must not throw in a non-browser runtime.
const layout = files.find((f) => f.rel === "app/layout.tsx");
if (layout) {
  const script = layout.text.match(/const THEME_INIT = `([\s\S]*?)`;/);
  ok("the inline theme script is guarded by try/catch", !!script && /try\{[\s\S]*\}catch/.test(script[1]));
}

console.log("\n— domain logic stays free of browser globals —");

// React Native provides no window/document. Anything in src/lib that reaches
// for them has to be rewritten during the port, so the set must not grow.
const KNOWN_BROWSER_ONLY = new Set(["lib/download.ts", "lib/gateway-client.ts"]);
const dirty = [];
for (const { rel, text } of files) {
  if (!rel.startsWith("lib/") || KNOWN_BROWSER_ONLY.has(rel)) continue;
  const hits = text.split("\n").filter((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return false;      // comments
    return /\b(window|document)\.|URL\.createObjectURL/.test(line);
  });
  if (hits.length) dirty.push(`${rel} (${hits.length})`);
}
ok("only the two documented modules use browser globals", dirty.length === 0, dirty.join(", "));

const libCount = files.filter((f) => f.rel.startsWith("lib/") && f.rel.endsWith(".ts")).length;
ok("src/lib still holds the domain logic", libCount >= 16, `${libCount} modules`);

console.log(fail === 0 ? `\nALL PASS (${pass}/${pass + fail})` : `\n${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
