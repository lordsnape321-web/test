/**
 * The checkout decision, and the backend contract it depends on.
 *
 *   npx esbuild scripts/gateway.test.mjs --bundle --platform=node --format=esm \
 *     --tsconfig=tsconfig.json --outfile=scripts/.tmp/gateway.mjs && node scripts/.tmp/gateway.mjs
 *
 * Two halves, because this feature lives on both sides of the wire:
 *
 *   1. `planCheckout` — given what the server said, does the app open the real
 *      test gateway, POST eSewa's form itself, or fall back to the simulator?
 *      Getting this wrong either strands a player on a blank tab or silently
 *      replaces a real payment with a fake one.
 *   2. The Laravel contract it relies on — `returnOrigin`, the clean return
 *      URLs eSewa/Khalti append their own query to, the published test
 *      credentials, and the hand-off page a native browser needs.
 *
 * Reading the PHP from here is deliberate: there is no PHP test runner in this
 * environment, and the one thing that must not drift is the shape the client
 * was written against.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const assert = {
  equal(actual, expected, what = "value") {
    if (actual !== expected) {
      throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  ok(condition, what) {
    if (!condition) throw new Error(what);
  },
};

import { esewaDataFromLocation, planCheckout } from "../src/lib/gateway-plan";

/* ── the decision ───────────────────────────────────────────────────────── */

// The real eSewa checkout: the server hands over the hand-off page, and the
// client resolves it against its own API base (same origin on the web).
{
  const plan = planCheckout("esewa", {
    handoffPath: "/api/payments/esewa/handoff?bookingId=12&returnOrigin=http%3A%2F%2Flocalhost%3A8081",
    testHint: "eSewa test server",
  });

  assert.equal(plan.kind, "gateway", "hand-off page opens the gateway");
  if (plan.kind === "gateway") {
    assert.ok(
      plan.url.endsWith("/api/payments/esewa/handoff?bookingId=12&returnOrigin=http%3A%2F%2Flocalhost%3A8081"),
      "hand-off URL keeps the server's query",
    );
  }
}

// A client that would rather build the form itself still can.
{
  const plan = planCheckout("esewa", {
    url: "https://rc-epay.esewa.com.np/api/epay/main/v2/form",
    fields: { total_amount: "1200", signature: "abc" },
  });

  assert.equal(plan.kind, "form", "raw fields mean a form POST");
  if (plan.kind === "form") {
    assert.equal(plan.url, "https://rc-epay.esewa.com.np/api/epay/main/v2/form");
    assert.equal(plan.fields.total_amount, "1200");
  }
}

// Khalti's answer is a page, not a form.
{
  const plan = planCheckout("khalti", { payment_url: "https://test-pay.khalti.com/?pidx=abc" });

  assert.equal(plan.kind, "gateway", "Khalti returns a page");
  if (plan.kind === "gateway") assert.equal(plan.url, "https://test-pay.khalti.com/?pidx=abc");
}

// Unreachable gateway → simulator, because a demo must never dead-end.
{
  const plan = planCheckout("khalti", { mock: true, mockUrl: "/payment/khalti/mock?pidx=mock-1" });

  assert.equal(plan.kind, "simulator", "mock:true falls back to the simulator");
}

// mock:true with no fallback URL is an error worth showing, not a blank tab.
{
  const plan = planCheckout("esewa", { mock: true, testHint: "gateway down" });

  assert.equal(plan.kind, "error", "mock without a simulator URL is an error");
  if (plan.kind === "error") assert.equal(plan.message, "gateway down");
}

// An incomplete answer must not open a gateway URL built from undefined.
{
  assert.equal(planCheckout("esewa", {}).kind, "error", "eSewa with nothing is an error");
  assert.equal(planCheckout("khalti", {}).kind, "error", "Khalti with nothing is an error");
  assert.equal(
    planCheckout("esewa", { fields: {} }).kind,
    "error",
    "an empty field set is not a checkout",
  );
}

/* ── reading eSewa's response off the URL ───────────────────────────────── */

const payload = "eyJ0cmFuc2FjdGlvbl91dWlkIjoiRk4tMTItYWJjIn0=";

assert.equal(
  esewaDataFromLocation(`?data=${encodeURIComponent(payload)}`),
  payload,
  "a clean ?data= is read",
);
assert.equal(
  esewaDataFromLocation(`?bookingId=12&data=${encodeURIComponent(payload)}`),
  payload,
  "data after other params is read",
);
assert.equal(
  esewaDataFromLocation(`?bookingId=12?data=${encodeURIComponent(payload)}`),
  payload,
  "a second '?' (eSewa appending to a URL that had a query) is still read",
);
assert.equal(esewaDataFromLocation("?data=a+b"), "a b", "plus signs decode as spaces");
assert.equal(esewaDataFromLocation(""), "", "no data is an empty string");
assert.equal(esewaDataFromLocation("?mock=1&bookingId=3"), "", "a simulator landing has no data");

/* ── the Laravel contract behind it ─────────────────────────────────────── */

/**
 * Read a file from the repository, wherever this bundle happens to run from.
 *
 * The launcher writes the bundle to `scripts/.tmp/`, so a fixed `../..` would
 * land inside the app. Walking up until the file exists works from both places.
 */
function repoFile(relative) {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }

  throw new Error(`could not find ${relative} from ${import.meta.url}`);
}

const php = (path) => readFileSync(repoFile(path), "utf8");
const flat = (path) => php(path).replace(/\s+/g, " ");

const payments = flat("laravel/app/Support/Payments.php");
const esewa = flat("laravel/app/Http/Controllers/Api/EsewaController.php");
const khalti = flat("laravel/app/Http/Controllers/Api/KhaltiController.php");
const routes = flat("laravel/routes/api.php");
const handoff = flat("laravel/app/Http/Controllers/Api/PaymentHandoffController.php");

// The published eSewa test values — the whole point of "the actual test server".
assert.ok(
  payments.includes("public const ESEWA_TEST_PRODUCT_CODE = 'EPAYTEST'") &&
    payments.includes("public const ESEWA_TEST_SECRET = '8gBm/:&EnhH.1/q'") &&
    payments.includes("rc-epay.esewa.com.np/api/epay/main/v2/form"),
  "eSewa defaults point at the real UAT server with the published test merchant",
);

// And the real login, which the hand-off page shows — the old hint had the
// password wrong, so this is pinned.
assert.ok(
  payments.includes("'password' => 'Nepal@123'") &&
    payments.includes("'id' => '9806800001'") &&
    payments.includes("'mpin' => '1122'") &&
    payments.includes("'token' => '123456'"),
  "eSewa test login is the published one (9806800001 / Nepal@123 / 1122 / 123456)",
);

// Khalti's sandbox key is what makes dev.khalti.com reachable with no setup,
// and it is overridable.
assert.ok(
  payments.includes("KHALTI_TEST_SECRET = 'live_secret_key_") &&
    /'secretKey' => trim\(\(string\) env\('KHALTI_SECRET_KEY', ''\)\) \?: self::KHALTI_TEST_SECRET/.test(payments),
  "Khalti defaults to the published sandbox key, overridable by env",
);
assert.ok(
  payments.includes("dev.khalti.com/api/v2/epayment/initiate/") &&
    payments.includes("dev.khalti.com/api/v2/epayment/lookup/"),
  "Khalti endpoints are the sandbox ones",
);
assert.ok(
  payments.includes("'id' => '9800000001'") && payments.includes("'mpin' => '1111'") && payments.includes("'otp' => '987654'"),
  "Khalti test payer credentials are the published ones",
);

// Both initiations take the app's own origin and validate it.
assert.ok(
  payments.includes("public static function returnOrigin(Request $request, mixed $explicit = null): string"),
  "returnOrigin() exists",
);
assert.ok(
  payments.includes("in_array(strtolower((string) $parts['scheme']), ['http', 'https'], true)") &&
    payments.includes("str_contains((string) $parts['host'], '0.0.0.0')"),
  "returnOrigin() only accepts a usable http(s) origin",
);
assert.ok(
  payments.includes("filter_var($origin, FILTER_VALIDATE_URL)") &&
    payments.includes("if (isset($parts['user']) || isset($parts['pass']))"),
  "returnOrigin() validates URL shape and refuses credentials",
);
assert.ok(
  esewa.includes("Payments::returnOrigin($request, $request->input('returnOrigin'))") &&
    khalti.includes("Payments::returnOrigin($request, $request->input('returnOrigin'))"),
  "both initiates use the app-supplied origin",
);

// Return URLs carry no query of their own: the gateways append theirs.
assert.ok(
  esewa.includes('$successUrl = "{$origin}/payment/esewa/success";') &&
    esewa.includes('$failureUrl = "{$origin}/payment/esewa/failure";'),
  "eSewa return URLs are clean",
);
assert.ok(
  khalti.includes('$returnUrl = "{$origin}/payment/khalti/callback";'),
  "Khalti return URL is clean",
);

// The hand-off page a native browser needs, reusing the one initiate path.
assert.ok(
  routes.includes("Route::get('/payments/esewa/handoff', [PaymentHandoffController::class, 'esewa'])"),
  "hand-off route is registered",
);
assert.ok(
  handoff.includes("Request::create('/api/payments/esewa/initiate'") &&
    handoff.includes("app()->instance('request', $outer)"),
  "hand-off replays the real initiate in-process and restores the request binding",
);
assert.ok(
  esewa.includes("'handoffPath' => '/api/payments/esewa/handoff?'"),
  "initiate tells the client where the hand-off page is",
);

// The client sends its origin, not a guess.
const api = php("futsal-expo-app/src/api/index.ts");
assert.ok(
  api.includes("returnOrigin: paymentReturnOrigin()"),
  "both initiate calls send returnOrigin",
);
const gatewayPlan = php("futsal-expo-app/src/lib/gateway-plan.ts");
assert.ok(
  !/from\s+["']react-native["']/.test(gatewayPlan),
  "gateway-plan.ts has no react-native import, so it can be bundled and tested",
);

console.log("gateway: all assertions passed");
