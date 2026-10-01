# Futsal Nepal — Expo app

The React Native/Expo frontend for Futsal Nepal. This app is paired with the
standalone Laravel API in `../laravel`; it does not require the retired web
application or any source code outside this directory at runtime.

The app is a full player and owner implementation. It includes authentication
and password reset, venue and court discovery, bookings and payments, open
matches, leagues, teams, players, notifications, profile, settings, reviews,
and the complete Owner Studio workflow.

## Quick start

Start the MySQL-backed Laravel API first. The backend example environment is
already configured for MySQL database `futsal` on `127.0.0.1:3306`:

```bash
cd ../laravel
composer install
cp .env.example .env
php artisan key:generate
mysql -u root -p -e "CREATE DATABASE futsal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
php artisan migrate --seed
php artisan serve --host=0.0.0.0 --port=8000
```

If your MySQL/MariaDB server uses different credentials, update the `DB_*`
values in `../laravel/.env` before `migrate --seed`. Expo talks only to
Laravel, and Laravel owns all application persistence in MySQL.

Then, in a second terminal, start Expo:

```bash
cd ../futsal-expo-app
npm install
cp .env.example .env
npm start                 # press i / a / w
```

The default API origin is Laravel at `http://localhost:8000`. Change
`EXPO_PUBLIC_API_BASE` in `.env` when the app runs on a different device:

| Client | API base |
|---|---|
| iOS simulator | `http://localhost:8000` |
| Android emulator | `http://10.0.2.2:8000` |
| Physical device | `http://<computer-LAN-IP>:8000` |

For a phone or a web preview, bind Laravel to `0.0.0.0` as shown above and make
sure the device can reach the computer. Laravel's local CORS configuration is
already open for the Expo web origin; restrict `CORS_ALLOWED_ORIGINS` before a
production deployment.

### Expo web proxy

The web build uses same-origin `/api/*` requests. `metro.config.js` proxies them
to Laravel on `127.0.0.1:8000`, so the browser never tries to call `localhost`
directly. Set the separate `EXPO_WEB_API_PROXY` variable if the web API is on a
different host or port; do not reuse the Android emulator value `10.0.2.2` for
this setting. A production web build should set `EXPO_PUBLIC_API_BASE` to the
public Laravel origin, for example `https://api.example.com`.

After changing either Expo API variable, stop and restart Expo: `EXPO_PUBLIC_*`
values are inlined into the bundle at build time. Before opening the app, check
`http://127.0.0.1:8000/api/health`; a healthy response is `{"ok":true}`.

## Verifying it works

```bash
npm run typecheck   # tsc --noEmit
npm run smoke       # live Laravel API booking/payment smoke test
```

`npm run smoke` bundles `scripts/smoke.ts` with esbuild and drives the same
`src/lib/api.ts` and `src/api/index.ts` modules the app ships through signup →
venues → courts → availability → booking → ledger → eSewa payment → settled.
The Laravel acceptance suites live in `../laravel/tests/api`.

Signup is two steps, so the smoke test needs the emailed code to finish it:

```bash
SIGNUP_CODE=123456 npm run smoke
```

Against a backend with no SMTP credentials configured, the code is written to
`../laravel/storage/logs/laravel.log` (the `log` mailer) — read it from there.
Everything after signup runs on the account it created.

Paying on a phone runs the gateway's page *inside the app* (a WebView sheet, so
nothing has to hand the player back from a browser), which needs one library:
`npm install` after pulling, for `react-native-webview` — Expo Go already bundles
the native side.

Paying on the test gateways can be checked without a database at all:

```bash
npx esbuild scripts/gateway.test.mjs --bundle --platform=node --format=esm \
  --tsconfig=tsconfig.json --outfile=scripts/.tmp/gateway.mjs
node scripts/.tmp/gateway.mjs
```

It covers the checkout decision (real gateway page vs. form POST vs. the replica
screen vs. an error) and reads the Laravel side to pin the contract it depends
on: the published test credentials, `returnOrigin`, the query-free return URLs,
the eSewa hand-off pages (booking and league), the two replica pages
(`laravel/public/demo-*.html`, served at `/api/payments/{gateway}/demo`) and that
the demo checkout settles through the same ledger path as a gateway payment.
The demo checkout is the app's own screens — `/payment/{esewa,khalti}/mock`,
with sign in → MPIN → token → the wallet's balance and the Pay button — and it
is the default; *Settings → Use the real eSewa and Khalti test servers* points
the checkout at the providers instead (`EXPO_PUBLIC_PAYMENT_MODE=real` for a
build). See `PAYMENT_PORT_NOTES.md` for how a checkout runs and how to point a
native build at the gateways.

Bundling for a device can be checked with:

```bash
npx expo export --platform ios
npx expo export --platform android
```

## Backend boundary

All network calls go through `src/lib/api.ts` and `src/api/index.ts`. The Expo
client sends the existing JSON contract under `/api`, while Laravel owns
validation, authorization, persistence, booking rules, payment verification,
ledger calculations, notifications, leagues, teams, and promos.

The client intentionally keeps the API's acting-user-id contract for now. The
signed-in user is cached in AsyncStorage and the relevant requests carry its
`userId`; no web server, database connection, or shared filesystem is needed by
the Expo app.

Two API shapes are adapted in the client:

- **No `GET /api/courts`** — courts are returned nested on a venue, so
  `fetchCourts()` reads the venue and lifts out active courts.
- **No `GET /api/bookings/:id`** — `fetchBooking()` reads the booking list,
  filtered by `userId`, and selects the requested id.

`venue.acceptedPayments` is a comma-separated string such as
`"eSewa,Khalti,Cash at Venue"`; split and trim it before comparing values.

## Shared client rules

These pure TypeScript modules keep client-side display and validation rules in
one place:

| Module | Role |
|---|---|
| `futsal.ts` | dates, time slots, `formatNPR`, slot expansion |
| `validation.ts` | form rules for email, phone, password, money, and more |
| `loyalty.ts` | trust score, deposits, and cancellation limits |
| `booking-ledger.ts` | ledger totals and the five-minute settlement window |
| `promos.ts`, `teams.ts`, `league.ts` | client-side constants and helpers |

`payments.ts` is deliberately not used in Expo: gateway signing belongs on the
Laravel server. The app calls Laravel's eSewa and Khalti initiate/verify routes.

## Layout

```
app/                  Expo Router screens
  _layout.tsx         providers and native stack
  (app)/              player tabs
  admin/              Owner Studio
  venue/[id].tsx      court and slot picker
  booking/[id].tsx    booking ledger and payment
src/
  api/index.ts        typed calls, one per Laravel route
  lib/                API seam, rules, storage, and response types
  context/            auth and theme providers
  components/         reusable native UI
  theme.ts            light/dark design tokens
scripts/smoke.ts      live Laravel smoke test
```

## Theming

Light and dark palettes live in `src/theme.ts` as plain objects. System mode is
the default and follows the device.
