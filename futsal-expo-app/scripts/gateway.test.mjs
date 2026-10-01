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
  payments.includes("'id' => '9711111111'") &&
    payments.includes("'password' => 'Test@123'") &&
    payments.includes("'mpin' => '1122'") &&
    payments.includes("'token' => '123456'"),
  "eSewa test login is the one its docs list today (9711111111 / Test@123)",
);
assert.ok(
  payments.includes("'alternates' => ['9711111112', '9711111113', '9806800001'") &&
    payments.includes("'legacyPassword' => 'Nepal@123'") &&
    payments.includes("public static function esewaTestLoginHint(): string"),
  "the older shared wallets are offered as alternates, in one shared hint",
);
assert.ok(
  !esewa.includes("9806800001 / Nepal@123") &&
    !flat("laravel/app/Http/Controllers/Api/TournamentPaymentController.php").includes("9806800001"),
  "no controller still prints the stale login",
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
  handoff.includes("string $path = '/api/payments/esewa/initiate'") &&
    handoff.includes("Request::create($path, 'POST', $payload, [], [], [") &&
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

/* ── league entry fees ride the same gateways ───────────────────────────── */

const league = flat("laravel/app/Http/Controllers/Api/TournamentPaymentController.php");
const leagueEntry = flat("laravel/app/Services/LeagueEntry.php");

// The initiate builds a real session, tells the app where to go, and offers the
// hand-off page a native browser needs.
assert.ok(
  league.includes("Payments::returnOrigin($request, $request->input('returnOrigin'))"),
  "league initiate takes the app's origin",
);
assert.ok(
  league.includes('$successUrl = "{$origin}/payment/esewa/success";') &&
    league.includes('$failureUrl = "{$origin}/payment/esewa/failure";') &&
    league.includes("'handoffPath' => '/api/payments/esewa/handoff/league?'"),
  "league eSewa returns are query-free and carry a hand-off path",
);
assert.ok(
  routes.includes("Route::get('/payments/esewa/handoff/league', [PaymentHandoffController::class, 'leagueEsewa'])") &&
    handoff.includes("Request::create($path, 'POST', $payload, [], [], [") &&
    handoff.includes("'action' => 'initiate'"),
  "the league hand-off is routed and replays the tournament initiate",
);
assert.ok(
  league.includes("'returnUrl' => \"{$origin}/payment/khalti/callback\"") &&
    !league.includes("empty($cfg['secretKey'])"),
  "league Khalti uses the sandbox and has no key-less bypass left",
);
assert.ok(
  league.includes("'mockUrl' => $mockUrl") && league.includes("'mock' => true"),
  "an unreachable gateway still falls back to the simulator, with a URL to reach it",
);

// Both real-gateway returns settle through one ledger path, and it is idempotent.
assert.ok(
  esewa.includes("if ($league = Payments::parseLeagueRef($uuid))") &&
    esewa.includes("LeagueEntry::settle($league['leagueId'], $league['teamId'], (int) round($paid), 'eSewa', $reference)"),
  "eSewa verifies a league entry from the signed blob",
);
assert.ok(
  khalti.includes("private function leagueEntry(string $pidx, string $orderId): ?JsonResponse") &&
    khalti.includes("LeagueEntry::settle($league['leagueId'], $league['teamId'], (int) round($paidPaisa / 100), 'Khalti', $reference)") &&
    khalti.includes("$this->cachedLookup = $lookup;"),
  "Khalti resolves a league entry from purchase_order_id without a second lookup",
);
assert.ok(
  leagueEntry.includes("if ($reference !== '' && self::alreadyRecorded($leagueId, $teamId, $reference))") &&
    leagueEntry.includes("League::TEAM_INVITED") &&
    leagueEntry.includes("Notifier::notify("),
  "the shared settle path is idempotent, accepts the invite, and tells the host",
);
assert.ok(
  league.includes("LeagueEntry::settle((int) $id, $teamId, $amount, $method, $txn)") &&
    !league.includes("TournamentPayment::create([\n                'tournament_id' => $id,\n                'team_id' => $teamId,\n                'user_id' => $userId,\n                'kind' => 'entry',\n                'amount' => $amount,\n                'method' => $method,\n                'reference' => mb_substr(\"{$method} checkout"),
  "the simulator route uses the same settle path instead of its own copy",
);

// The client: the captain's Pay button opens the gateway, not the simulator.
const panel = php("futsal-expo-app/src/components/LeagueSquadPanel.tsx");
assert.ok(
  panel.includes("prepareGatewayTab()") &&
    panel.includes("startLeagueCheckout(league.id, method as \"eSewa\" | \"Khalti\"") &&
    panel.includes("if (outcome.status === \"gateway\")"),
  "the league Pay button opens the real gateway first",
);
const checkout = php("futsal-expo-app/src/lib/checkout.ts");
assert.ok(
  checkout.includes("export function startLeagueCheckout(") &&
    checkout.includes("initiateLeaguePayment(leagueId, { ...input, method })"),
  "checkout.ts covers league entry fees",
);
assert.ok(
  api.includes("export function initiateLeaguePayment(") &&
    api.includes("json: { action: \"initiate\", ...input, returnOrigin: paymentReturnOrigin() }"),
  "the league initiate sends its origin like the booking one",
);

/* ── a flaky test server must not strand the payer ──────────────────────── */

// eSewa's own wording for a server timeout is "Service is currently
// unavailable. Please try again later." Sending a browser there in that state
// leaves nothing to verify, so the server checks first and answers `mock: true`.
assert.ok(
  payments.includes("public static function reachable(string $url): bool") &&
    payments.includes("Http::connectTimeout(3)->timeout(6)->get($url)->status() > 0"),
  "Payments::reachable() catches a down gateway, and only a down one",
);
assert.ok(
  esewa.includes("if (! Payments::reachable((string) $cfg['formUrl']))") &&
    esewa.includes("'fallbackError' => 'The eSewa test server is not answering',"),
  "a booking checkout falls back to the simulator instead of eSewa's error page",
);
assert.ok(
  league.includes("if (! Payments::reachable((string) ($cfg['formUrl'] ?? '')))"),
  "a league checkout does the same",
);
assert.ok(
  handoff.includes("Service is currently unavailable") &&
    handoff.includes("Pay on the local simulator instead"),
  "the hand-off page explains eSewa's error and offers the simulator",
);

// And a returned payment can be retried in one tap: the failure screens live on
// a different route, so the checkout that started one is remembered.
assert.ok(
  checkout.includes("export function rememberCheckout(attempt: RememberedCheckout): void") &&
    checkout.includes("export async function retryLastCheckout(): Promise<RetryOutcome>") &&
    checkout.includes("export function canRetryCheckout(): boolean"),
  "checkout.ts remembers the last attempt and can re-run it",
);
const screens = php("futsal-expo-app/src/components/PaymentScreens.tsx");
assert.ok(
  screens.includes("function useCheckoutRetry()") &&
    screens.includes("retryLastCheckout()") &&
    screens.includes('primaryLabel={retry.retryable ? (retry.busy ? "Opening…" : "Try again") : undefined}'),
  "the eSewa failure screen offers Try again",
);
assert.ok(
  screens.includes('primaryLabel={state === "failure" && retry.retryable ? (retry.busy ? "Opening…" : "Try again") : undefined}'),
  "so does a failed Khalti session",
);
for (const site of ["futsal-expo-app/app/booking/[id].tsx", "futsal-expo-app/app/(app)/bookings.tsx"]) {
  const file = php(site);
  assert.ok(
    /rememberCheckout\(\{[\s\S]{0,400}?startGatewayCheckout\(/.test(file),
    `${site} remembers its checkout`,
  );
}
const panelSource = php("futsal-expo-app/src/components/LeagueSquadPanel.tsx");
assert.ok(
  panelSource.includes("settle: settleOnSimulator") && panelSource.includes("donePath: `/leagues/${league.id}`"),
  "a league checkout remembers its in-place simulator settle",
);

/* ── a "failed" page must not hide money that moved ─────────────────────── */

assert.ok(
  esewa.includes("$recoveredSession = $this->recoverSession($request, $hintBookingId)") &&
    esewa.includes("private function recoverSession(Request $request, ?int $hintBookingId): array|JsonResponse"),
  "a return without a signed blob asks eSewa about the session instead of giving up",
);
assert.ok(
  esewa.includes("'transactionUuid' => $uuid, 'totalAmount' => $expected,") &&
    esewa.includes("if ($s !== 'COMPLETE')") &&
    esewa.includes("'recovered' => true,"),
  "recovery uses the stored reference, the same amount, and only settles a COMPLETE session",
);
assert.ok(
  esewa.includes("if (in_array($s, ['CANCELED', 'FULL_REFUND', 'PARTIAL_REFUND'], true))"),
  "only a definitive negative stops a signed COMPLETE payment",
);
assert.ok(
  esewa.includes("if (! $recovered) {") && esewa.includes("$status = Payments::esewaStatusCheck(["),
  "the normal path still double-checks with the status API",
);

// And the app can ask: the failure screen offers it.
assert.ok(
  checkout.includes("export async function checkLastCheckout(): Promise<CheckOutcome>") &&
    checkout.includes("export function canCheckCheckout(): boolean"),
  "checkout.ts can ask the gateway about the last attempt",
);
assert.ok(
  screens.includes("secondaryLabel={retry.checkable ? (retry.checking ? \"Asking eSewa…\" : \"Check with eSewa\") : undefined}") &&
    screens.includes('if (outcome.status === "settled") setSettled(outcome.message);'),
  "the eSewa failure screen offers Check with eSewa and can flip to success",
);
const bookingFile = php("futsal-expo-app/app/booking/[id].tsx");
assert.ok(
  bookingFile.includes("check: async () => {") && bookingFile.includes("verifyEsewa({\n              bookingId,"),
  "a booking checkout remembers how to check itself",
);

/* ── the sandbox is no longer what a payer sees ─────────────────────────── */

const gateway = php("futsal-expo-app/src/lib/gateway.ts");
assert.ok(
  gateway.includes("Constants.expoConfig?.hostUri") &&
    gateway.includes("return configuredMode !== \"simulator\";"),
  "every platform tries the real server; a device derives its origin from the dev server",
);
const enabledFn = gateway.slice(
  gateway.indexOf("export function realGatewayEnabled"),
  gateway.indexOf("export function realGatewayEnabled") + 220,
);
assert.ok(
  !enabledFn.includes("Platform.OS") && !enabledFn.includes("paymentReturnOrigin"),
  "realGatewayEnabled has no platform gate: a phone is not sent to the simulator",
);
const bookingDetail = php("futsal-expo-app/app/booking/[id].tsx");
assert.ok(
  !screens.includes("Sandbox simulator") &&
    screens.includes("Simulator • gateway unreachable") &&
    screens.includes("const [settled, setSettled] = useState(\"\");"),
  "the mock screen is labelled a fallback, and it shows the server's own sentence",
);
assert.ok(
  !bookingDetail.includes("Sandbox mode — no real money moves") &&
    bookingDetail.includes("test server"),
  "the booking screen no longer promises a sandbox",
);

console.log("gateway: all assertions passed");
