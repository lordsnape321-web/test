/**
 * Unqualified class references that resolve to nothing — a fatal at runtime.
 *
 * This exists because one shipped: `BookingController` called
 * `League::recordFor(...)` without `use App\Support\League;`. The file lives in
 * `App\Http\Controllers\Api`, so PHP looked for
 * `App\Http\Controllers\Api\League`, found nothing, and every attempt to score
 * a competition game died with "Class … not found" — an error no test caught,
 * because it only fires on the one code path that scores a fixture.
 *
 * PHP's rule is what makes this findable statically:
 *
 *   • an unqualified name is resolved against the file's namespace first,
 *   • and only if that does not exist does PHP fall back to the global
 *     namespace.
 *
 * So a bare `Foo::` is a bug exactly when neither `Current\Namespace\Foo` nor
 * `\Foo` exists. This walks `app/` (the PSR-4 root the composer autoloader maps)
 * and reports the ones that resolve nowhere — with the line, so the fix is
 * obvious.
 *
 * Run: node laravel/tests/static/class-refs.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const laravelRoot = join(here, "..", "..");
const appRoot = join(laravelRoot, "app");

/** `App\Foo\Bar` → `app/Foo/Bar.php`, the mapping composer's PSR-4 rule uses. */
function classFileExists(fqn) {
  if (!fqn.startsWith("App\\")) return false;

  const parts = fqn.slice("App\\".length).split("\\");
  const path = join(appRoot, ...parts) + ".php";

  return exists(path) && isFile(path);
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Classes the engine, its extensions, or the framework provide under a global
 * (or otherwise unimported) name. Anything here resolves, so it is not a bug.
 */
const GLOBAL_OK = new Set([
  // Engine
  "stdClass", "Closure", "Generator", "WeakMap", "WeakReference", "Fiber",
  "Exception", "Error", "Throwable", "TypeError", "ValueError", "ArgumentCountError",
  "ArithmeticError", "DivisionByZeroError", "ErrorException", "ParseError",
  "InvalidArgumentException", "RuntimeException", "LogicException", "DomainException",
  "OutOfBoundsException", "OutOfRangeException", "LengthException", "RangeException",
  "UnexpectedValueException", "BadFunctionCallException", "BadMethodCallException",
  "OverflowException", "UnderflowException", "JsonException", "UnhandledMatchError",
  "DateTime", "DateTimeImmutable", "DateTimeInterface", "DateInterval", "DatePeriod",
  "DateTimeZone", "ArrayObject", "ArrayIterator", "SplStack", "SplQueue",
  "SplObjectStorage", "SplFixedArray", "SplFileObject", "SplFileInfo",
  "Countable", "Iterator", "IteratorAggregate", "ArrayAccess", "Traversable",
  "JsonSerializable", "Stringable", "Serializable", "ReflectionClass",
  "ReflectionMethod", "ReflectionProperty", "PDO", "PDOException", "PDOStatement",
  "NumberFormatter", "IntlDateFormatter", "Collator", "Normalizer", "IntlChar",
  "finfo", "CurlHandle", "CurlMultiHandle", "GdImage", "XMLReader", "XMLWriter",
  "SimpleXMLElement", "DOMDocument", "DOMElement", "SoapClient", "ZipArchive",
  "DirectoryIterator", "FilesystemIterator", "RecursiveDirectoryIterator",
  "RecursiveIteratorIterator", "LimitIterator", "CallbackFilterIterator",
]);

/** `use A\B\C;` / `use A\B\C as D;` → alias → FQN. */
function importsOf(src) {
  const map = new Map();

  for (const m of src.matchAll(/^use\s+([^;]+);/gm)) {
    const clause = m[1].trim();
    // `use function …` / `use const …` are not class aliases.
    if (/^(function|const)\s/i.test(clause)) continue;
    // Grouped: `use A\B\{C, D as E};`
    const group = /^(.+?)\\\{(.+)\}$/.exec(clause);
    const entries = group ? group[2].split(",").map((e) => `${group[1].trim()}\\${e.trim()}`) : clause.split(",");

    for (const entry of entries) {
      const clean = entry.trim().replace(/\s+/g, " ");
      if (!clean) continue;
      const [fqn, alias] = clean.split(/\s+as\s+/i);
      const short = (alias ?? fqn.split("\\").pop()).trim();
      map.set(short, fqn.trim().replace(/^\\/, ""));
    }
  }

  return map;
}

function namespaceOf(src) {
  const m = /^namespace\s+([^;{]+);/m.exec(src);
  return m ? m[1].trim() : "";
}

/** Every .php file under app/, recursively. */
function phpFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) phpFiles(full, out);
    else if (name.endsWith(".php")) out.push(full);
  }

  return out;
}

const problems = [];
const SKIP = new Set(["self", "static", "parent", "class", "this", "bool", "int", "string", "array", "float", "void", "mixed", "object", "callable", "iterable", "null", "false", "true"]);

for (const file of phpFiles(appRoot)) {
  const src = readFileSync(file, "utf8");
  const ns = namespaceOf(src);
  const imports = importsOf(src);
  // Comments carry examples like `Foo::bar()`; they are not code. Block
  // comments are blanked first, keeping every newline so line numbers survive.
  const uncommented = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const lines = uncommented.split("\n");

  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");

    for (const m of code.matchAll(/(?<![\w$>:\\-])([A-Z][A-Za-z0-9_]*)::/g)) {
      const name = m[1];
      if (SKIP.has(name)) continue;
      if (imports.has(name)) continue;

      const namespaced = ns ? `${ns}\\${name}` : name;
      if (classFileExists(namespaced)) continue;
      if (GLOBAL_OK.has(name)) continue;
      if (classFileExists(name)) continue;

      problems.push({
        file: relative(laravelRoot, file),
        line: i + 1,
        name,
        tried: [namespaced, name],
      });
    }
  });
}

if (problems.length) {
  for (const p of problems) {
    console.error(
      `  ${p.file}:${p.line}  ${p.name}:: resolves to nothing — expected ${p.tried[0]} or \\${p.tried[1]}`,
    );
  }

  console.error(`\n${problems.length} unresolved class reference(s).`);
  process.exit(1);
}

console.log("class refs ok");
