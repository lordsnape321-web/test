#!/usr/bin/env node
/**
 * Generates docs/api-routes.md — the inventory of every HTTP endpoint this app
 * exposes.
 *
 * This is the surface a Laravel backend has to reimplement, so it is generated
 * from src/app/api/**\/route.ts rather than written by hand. Hand-written API
 * docs drift; this cannot, because tests/portability.mjs re-runs it and fails if
 * the checked-in file no longer matches.
 *
 *   node scripts/api-routes.mjs           # print to stdout
 *   node scripts/api-routes.mjs --write   # rewrite docs/api-routes.md
 *   node scripts/api-routes.mjs --check   # exit 1 if the file is stale
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = join(app, "src", "app", "api");
const docPath = join(app, "docs", "api-routes.md");

const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"];

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e === "route.ts") out.push(p);
  }
  return out;
}

function collect() {
  return walk(apiDir)
    .map((file) => {
      const src = readFileSync(file, "utf8");
      const seg = relative(apiDir, dirname(file));
      // Next.js dynamic segments [id] become {id} to read like a Laravel route.
      const path = "/" + (seg === "." ? "" : seg).replace(/\[/g, "{").replace(/\]/g, "}");
      const methods = METHODS.filter((m) =>
        new RegExp(`export\\s+async\\s+function\\s+${m}\\b`).test(src));
      return { path: path || "/", methods, file: relative(app, file).replace(/\\/g, "/") };
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.methods.join().localeCompare(b.methods.join()));
}

function render(rows) {
  const total = rows.reduce((n, r) => n + r.methods.length, 0);
  const lines = [
    "# API surface",
    "",
    `**Generated file — do not edit.** Run \`node scripts/api-routes.mjs --write\` instead.`,
    "",
    `Every HTTP endpoint this app exposes: **${rows.length} route files, ${total} endpoints**.`,
    "",
    "This is the contract a Laravel backend has to reimplement. It is generated",
    "from `src/app/api/**/route.ts` by `scripts/api-routes.mjs`, and",
    "`tests/portability.mjs` fails if this file drifts from the routes on disk.",
    "",
    "Behaviour — status codes, validation rules, the money ledger's locking — is",
    "specified by the suites in `tests/api/`, which assert over plain HTTP and so",
    "can be pointed at a Laravel host with `BASE_URL`.",
    "",
    "| Method | Path | Source |",
    "| --- | --- | --- |",
  ];
  for (const r of rows) {
    for (const m of r.methods) lines.push(`| \`${m}\` | \`${r.path}\` | \`${r.file}\` |`);
    if (!r.methods.length) lines.push(`| — | \`${r.path}\` | \`${r.file}\` |`);
  }
  lines.push("");
  return lines.join("\n");
}

const mode = process.argv[2] ?? "";
const output = render(collect());

if (mode === "--write") {
  mkdirSync(dirname(docPath), { recursive: true });
  writeFileSync(docPath, output);
  console.log(`wrote ${relative(app, docPath)}`);
} else if (mode === "--check") {
  if (!existsSync(docPath)) {
    console.error(`missing ${relative(app, docPath)} — run: node scripts/api-routes.mjs --write`);
    process.exit(1);
  }
  if (readFileSync(docPath, "utf8") !== output) {
    console.error(`${relative(app, docPath)} is stale — run: node scripts/api-routes.mjs --write`);
    process.exit(1);
  }
  console.log(`${relative(app, docPath)} is up to date`);
} else {
  process.stdout.write(output);
}
