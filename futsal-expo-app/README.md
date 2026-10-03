# Futsal Mate — Expo app

The React Native/Expo frontend for Futsal Mate. This app is paired with the
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
node scripts/parity.test.mjs   # web/mobile parity guards (no backend needed)
```

`scripts/armband.test.mjs`, `scripts/batch.test.mjs` and
`scripts/parity.test.mjs` are source-level regression guards and run plain.
`scripts/parity.test.mjs` is the web/mobile parity one — it pins that every
confirmation goes through `src/lib/confirm.ts` (the browser's own dialog on web,
`Alert` on a phone) instead of `Alert.alert`, which react-native-web implements
as a no-op, and it holds the shapes of this round's other five fixes: a single
label per field, a swatch row that wraps, a delete cue on the side the swipe
uncovers, and the owner's delete-account flow.

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

## Building the APK

The app is generated natively at build time (`npx expo prebuild`), so `android/`
and `ios/` are not in the tree. There are two ways to get an installable APK.

**On GitHub (nothing to install locally).** `.github/workflows/android-apk.yml`
builds one on every push to the session branch and to `main`: it installs the
dependencies, runs `expo prebuild`, and runs `./gradlew assembleRelease`. The
APK is attached to the run as the **futsal-mate-apk** artifact (Actions → the
run → Artifacts), and the same file is published as the rolling **apk**
prerelease — <https://github.com/lordsnape321-web/test/releases/tag/apk> —
because a release asset downloads without a GitHub login and an artifact does
not. Release builds are signed with the debug keystore the
generated project creates for itself, which is exactly what makes an APK
installable — Android refuses an unsigned one. Publishing to the Play Store
would mean a real keystore, kept out of git in a secret.

**On a machine with the Android SDK.** Install Android Studio (which brings the
SDK, the NDK and a JDK), then:

```bash
npm ci
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
# android/app/build/outputs/apk/release/app-release.apk
adb install -r app/build/outputs/apk/release/app-release.apk
```

One ABI is enough for a phone and keeps the file small:

```bash
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

(Use `armeabi-v7a` for a pre-2016 device, `x86_64` for an emulator, or pass
several comma-separated.)

### Pointing the APK at a backend

A dev build learns the API origin from the Metro server it was loaded from; an
installed APK has no Metro server, so its backend address comes from either:

- `EXPO_PUBLIC_API_BASE` at build time (the workflow reads the repository
  variable `API_BASE`, *Settings → Secrets and variables → Actions → Variables*),
  or
- the sign-in screen's **⚙️ Server** row, which saves an address on the device
  itself — `http://192.168.1.20:8000` for a Laravel on the same Wi-Fi. That is
  the one to use when the backend is on your own machine and its address is not
  known when the APK is built.

A phone's `localhost` is the phone, so the app says so when a request cannot
connect, and points at that row.

Two things have to line up for a LAN address to work:

- **Laravel has to listen on the network.** `php artisan serve` binds
  `127.0.0.1` by default, which the phone cannot reach; start it with
  `php artisan serve --host=0.0.0.0 --port=8000` (and allow the port through the
  computer's firewall).
- **Android has to allow plain http.** Release builds block cleartext traffic by
  default, which looks exactly like an unreachable API
  ("CLEARTEXT communication to … not permitted by network security policy").
  `app.json` sets `usesCleartextTraffic: true` through `expo-build-properties`,
  so a current APK can talk to `http://<LAN IP>:8000`. A build made before that
  setting existed cannot — reinstall the newest APK. An https backend needs no
  exception, and its certificate has to be valid.

## Push notifications

Notifications already work without any of this: every event writes a row,
the bell polls and `/notifications` lists them. Push adds the part that
matters — finding out while the app is closed.

Three legs, in the order they start working:

1. **The in-app bell.** Always on, no setup. `laravel/app/Services/Notifier.php`
   is the single funnel; every controller calls it.
2. **Foreground banners.** With the notification permission granted, a message
   that lands while the app is open is presented as a real device banner instead
   of only moving the badge — `announceNewNotifications()` in `src/lib/push.ts`,
   driven by the bell's existing 15-second poll. This works in Expo Go and in an
   APK with no accounts or keys.
3. **Remote push (app closed).** The server forwards every push-worthy
   notification to Expo's push service (`App\Services\PushSender`), which fans
   out to FCM/APNs. This is the only leg that needs something from you: Expo has
   to know which project the tokens belong to.

   ```bash
   EXPO_PUBLIC_EAS_PROJECT_ID=<uuid>     # at build time, or extra.eas.projectId in app.json
   ```

   The UUID comes from `eas init` (or `eas project:info`) once the project is
   linked to an Expo account. Set it as the repository **variable**
   `EAS_PROJECT_ID` and the APK workflow bakes it in; leave it unset and the app
   logs one line, keeps the bell and the banners, and shows "This build has no
   Expo project id yet" under Settings → Phone notifications. Nothing else has
   to change to switch it on: phones register themselves on the next launch.

   The APK run also asserts that the generated manifest carries
   `POST_NOTIFICATIONS` and Expo's Firebase messaging service, so a build that
   could never receive push fails the check instead of shipping quietly broken.

The phone side lives in `src/lib/push.ts` (permission, token, tap routing) and
`src/components/PushBridge.tsx` (registers on sign-in, forgets the handset on
sign-out). Settings → Phone notifications is the switch, saved on the account
(`push_notifications`) *and* mirrored in the phone's own token registration, so
turning it off stops the buzz immediately without losing the permission.

Which messages get pushed is decided in one place — the `PUSH_TYPES` list in
`Notifier` — and is deliberately the same list as the emails: bookings,
payments, squads, leagues and kick-off reminders. Reviews and promo chatter stay
in the bell, where they can wait.

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
