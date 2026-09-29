/**
 * A structural check for the cases brace counting and JSX-depth miss.
 *
 * Those two both passed on a file where a `type Props = {` literal had a
 * function declaration spliced into its middle — the braces balanced and the
 * Text tags matched, and the file was still unparseable. Metro rejected it at
 * "Unexpected token, expected ";"", and the only reason it got committed is
 * that nothing here could see the damage.
 *
 * So: find every type/interface literal, and assert that what lives inside it
 * is a member list and nothing else. A `function`, an `import`, a `return` or
 * a `const` inside a type literal is always a mistake, and always a
 * syntactically fatal one.
 *
 * Run: node scripts/structure-check.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["app", "src", "components"];

/** Strip strings and comments so the scan cannot trip over prose. */
function blank(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < src.length && src[i] !== "\n") out += " ", i++;
    } else if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      while (i < stop) out += src[i] === "\n" ? "\n" : " ", i++;
    } else if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += " ";
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (src[i] === q) {
          out += " ";
          i++;
          break;
        }
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const problems = [];

function walk(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".expo" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.tsx?$/.test(name)) files.push(full);
  }
  return files;
}

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    const code = blank(src);
    const lines = code.split("\n");

    // Every `type X = {` / `interface X {` literal must close on a line that
    // is only the closer plus optional punctuation.
    const open = /(^|\s)(type\s+\w+\s*=\s*\{|interface\s+\w+\s*\{)/;
    for (let i = 0; i < lines.length; i++) {
      if (!open.test(lines[i])) continue;

      let depth = 0;
      let closedAt = -1;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) {
              closedAt = j;
              break;
            }
          }
        }
        if (closedAt !== -1) break;
      }
      if (closedAt === -1) {
        problems.push(`${file}:${i + 1}  type literal never closes`);
        continue;
      }

      // Inside the literal, only members. A statement here cannot parse.
      for (let j = i + 1; j < closedAt; j++) {
        const t = lines[j].trim();
        if (!t) continue;
        if (/^(function|const|let|var|return|import|export|async)\b/.test(t)) {
          problems.push(
            `${file}:${j + 1}  "${t.split(/[\s({]/)[0]}" inside a type literal — a type body cannot contain it`,
          );
        }
      }
    }
  }
}

if (problems.length) {
  for (const p of problems) console.error("  " + p);
  console.error(`\n${problems.length} structural problem(s).`);
  process.exit(1);
}
console.log("structure ok");
