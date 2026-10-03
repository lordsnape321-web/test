/**
 * Unqualified class references that resolve to nothing — a fatal at runtime.
 *
 * This exists because one shipped: `BookingController` called
 * `League::recordFor(...)` without `use App\Support\League;`. The file lives in
 * `App\Http\Controllers\Api`, so PHP looked for
 * `App\Http\Controllers\Api\League`, found nothing, and every attempt to score a
 * competition game died with "Class … not found" — an error no test caught,
 * because it only fires on the one code path that scores a fixture.
 *
 * PHP's rule is what makes this findable statically:
 *
 *   • an unqualified name is resolved against the file's namespace first,
 *   • and only if that does not exist does PHP fall back to the global
 *     namespace.
 *
 * So `Foo::` is a bug exactly when neither `Current\Namespace\Foo` nor `\Foo`
 * is a class this codebase declares. This walks the whole Laravel tree — `app/`
 * and also `routes/`, `database/`, `config/`, `public/` and `tests/`, because a
 * seeder or a route file is resolved by the same rule and fails the same way —
 * and reports the ones that resolve nowhere.
 *
 * It checks the *other* half of the same bug too: a `use` statement pointing at
 * a class that does not exist. PHP never complains about an import until the
 * line that needs it runs, so `use App\Support\Leagues;` is a typo that ships
 * silently and then 500s, exactly like the missing import did.
 *
 * Run: node laravel/tests/static/class-refs.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const laravelRoot = join(here, "..", "..");

/**
 * Where a class can be referenced.
 *
 * Class references may appear in any of these, and each is resolved by the same
 * namespace rule.
 */
const SCAN_ROOTS = ["app", "routes", "database", "config", "public", "tests"].map((dir) =>
  join(laravelRoot, dir),
);

/**
 * The composer PSR-4 map — prefix to directory.
 *
 * Read from composer.json rather than hard-coded, because that file is what the
 * autoloader actually obeys: a class is "found" precisely when its name maps
 * onto a file through one of these prefixes. Both `autoload` and `autoload-dev`
 * count (`Tests\` only exists in the dev block).
 */
function psr4Map() {
  const composer = JSON.parse(readFileSync(join(laravelRoot, "composer.json"), "utf8"));

  return {
    ...(composer.autoload?.["psr-4"] ?? {}),
    ...(composer.autoloadDev?.["psr-4"] ?? composer["autoload-dev"]?.["psr-4"] ?? {}),
  };
}

const PSR4 = psr4Map();

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

/** Every .php file under a directory, recursively. */
function phpFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);

    if (statSync(full).isDirectory()) phpFiles(full, out);
    else if (name.endsWith(".php")) out.push(full);
  }

  return out;
}

/** Blank out comments, keeping every newline so line numbers survive. */
function uncomment(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function namespaceOf(src) {
  const match = /^namespace\s+([^;{]+);/m.exec(src);

  return match ? match[1].trim() : "";
}

/** `use A\B\C;` / `use A\B\C as D;` → [{ alias, fqn, line }]. */
function importsOf(src) {
  const imports = [];

  src.split("\n").forEach((line, index) => {
    const match = /^\s*use\s+([^;]+);/.exec(line);

    if (!match) return;

    const clause = match[1].trim();

    // `use function …` / `use const …` are not class aliases.
    if (/^(function|const)\s/i.test(clause)) return;

    // Grouped: `use A\B\{C, D as E};`
    const group = /^(.+?)\\\{(.+)\}$/.exec(clause);
    const entries = group
      ? group[2].split(",").map((entry) => `${group[1].trim()}\\${entry.trim()}`)
      : clause.split(",");

    for (const entry of entries) {
      const clean = entry.trim().replace(/\s+/g, " ");

      if (!clean) continue;

      const [fqn, alias] = clean.split(/\s+as\s+/i);

      imports.push({
        alias: (alias ?? fqn.split("\\").pop()).trim(),
        fqn: fqn.trim().replace(/^\\/, ""),
        line: index + 1,
      });
    }
  });

  return imports;
}

/**
 * The class-like symbols this checkout declares: `Fully\Qualified\Name` → file.
 *
 * Built by reading the mapped directories, so a name is "found" only when a real
 * file declares it — which also catches the case where a class name and its file
 * have drifted apart.
 */
function symbolIndex() {
  const symbols = new Map();
  const roots = Object.values(PSR4).map((dir) => join(laravelRoot, dir)).filter(exists);

  for (const root of roots) {
    for (const file of phpFiles(root)) {
      const src = uncomment(readFileSync(file, "utf8"));
      const ns = namespaceOf(src);

      for (const match of src.matchAll(/^\s*(?:final\s+|abstract\s+|readonly\s+)*(?:class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
        symbols.set(ns ? `${ns}\\${match[1]}` : match[1], relative(laravelRoot, file));
      }
    }
  }

  return symbols;
}

const SYMBOLS = symbolIndex();

/** Any `App\…`, `Database\…`, `Tests\…` name that maps to a declared symbol. */
function classExists(fqn) {
  return SYMBOLS.has(fqn);
}

/**
 * Names the engine, its extensions, or the framework provide under a global (or
 * otherwise unimported) name. Anything here resolves, so it is not a bug; it is
 * also the list that makes a missing import stand out, since a class this
 * codebase never declares must have been imported.
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

/** Keywords and type names that match `Foo::` but are not classes. */
const NOT_A_CLASS = new Set([
  "self", "static", "parent", "class", "this",
  "bool", "int", "float", "string", "array", "object", "callable", "iterable",
  "mixed", "void", "never", "null", "false", "true",
]);

const problems = [];
const brokenImports = [];
const scanned = SCAN_ROOTS.flatMap((root) => (exists(root) ? phpFiles(root) : []));

for (const file of scanned) {
  const raw = readFileSync(file, "utf8");
  const code = uncomment(raw);
  const ns = namespaceOf(code);
  const imports = importsOf(code);
  const imported = new Set(imports.map((one) => one.alias));

  // Every import must point at a class this checkout declares. `Illuminate\…`
  // and friends live in vendor/, which is not installed here and must not be
  // judged; only names the PSR-4 map owns can be checked.
  const owns = (fqn) => Object.keys(PSR4).some((prefix) => fqn.startsWith(prefix));

  for (const { alias, fqn, line } of imports) {
    if (owns(fqn) && !classExists(fqn)) {
      brokenImports.push({ file: relative(laravelRoot, file), line, alias, fqn });
    }
  }

  code.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/(?<![\w$>:\\-])([A-Z][A-Za-z0-9_]*)::/g)) {
      const name = match[1];

      if (NOT_A_CLASS.has(name) || GLOBAL_OK.has(name) || imported.has(name)) continue;

      // Same namespace first, then the global namespace — PHP's order exactly.
      if (ns && classExists(`${ns}\\${name}`)) continue;
      if (classExists(name)) continue;

      problems.push({
        file: relative(laravelRoot, file),
        line: index + 1,
        name,
        tried: [ns ? `${ns}\\${name}` : name, name],
      });
    }
  });
}

let failed = false;

for (const { file, line, alias, fqn } of brokenImports) {
  failed = true;
  console.error(`  ${file}:${line}  import ${alias} → ${fqn} does not exist`);
}

for (const problem of problems) {
  failed = true;
  console.error(
    `  ${problem.file}:${problem.line}  ${problem.name}:: resolves to nothing — expected ${problem.tried[0]} or \\${problem.tried[1]}`,
  );
}

if (failed) {
  console.error(
    `\n${brokenImports.length} broken import(s), ${problems.length} unresolved class reference(s).`,
  );
  process.exit(1);
}

console.log(`class refs ok (${scanned.length} files, ${SYMBOLS.size} classes)`);
