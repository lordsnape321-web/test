# Futsal Nepal — Expo app

The React Native (Expo) port of the Futsal Nepal web app. This is the **frontend
half** of the migration; the Laravel backend comes later in its own directory.

The first pass is a **vertical slice** — one complete flow end to end:

> sign up → browse venues → pick a court and slot → book → pay → see it settled

That flow exercises every pattern the full app needs (navigation, API client,
async storage, theming, form validation), so the remaining ~27 screens repeat a
proven shape rather than inventing one.

## Quick start

```bash
npm install

# Point at a running backend (see .env.example for device-specific hosts)
cp .env.example .env

npm start          # Expo dev server — press i / a / w
```

The app talks to the **existing Next.js API** during the migration. Start that
first (`react-expo-laravel-futsal-app`, `npm run dev` on port 3000), then run
this app against it.

## Verifying it works

```bash
npm run typecheck   # tsc --noEmit
npm run smoke       # end-to-end against the live API (needs the backend up)
```

`npm run smoke` bundles `scripts/smoke.ts` with esbuild and runs it in Node. It
drives the **same** `src/lib/api.ts` and `src/api/index.ts` the app ships — not a
re-implementation — through signup → venues → courts → availability → booking →
ledger → eSewa payment → settled, asserting the money actually moved in the
ledger. 20 checks.

Bundling for a device is proven with:

```bash
npx expo export --platform ios
npx expo export --platform android
```

## What was ported verbatim

These modules are **byte-identical** to the Next.js `src/lib` versions — copied,
not rewritten. They are pure TypeScript with no browser or Node globals, so the
same business rules run on web and native:

| module | role |
|---|---|
| `futsal.ts` | dates, time slots, `formatNPR`, slot expansion |
| `validation.ts` | every form rule (email, phone, password, money, …) |
| `loyalty.ts` | trust score, deposit decision, cancellation limits |
| `booking-ledger.ts` | ledger totals, the 5-minute settlement window |
| `promos.ts`, `teams.ts`, `league.ts` | constants `validation.ts` imports |

Sharing these is the point: a rule changed once applies to both apps, and a
player can never be told "invalid" here but accepted on the web.

## What had to change for React Native

Two seams could not be copied, because the platforms genuinely differ:

- **`src/lib/api.ts`** — the env prefix is `EXPO_PUBLIC_`, not `NEXT_PUBLIC_`,
  and a base URL is mandatory (RN has no origin, so relative paths throw).
- **`src/lib/storage.ts`** — AsyncStorage is **async**; localStorage is not. The
  in-memory-map-plus-durable-backing-store design is the same, but reads go
  through `initStorage()` hydration first.

`payments.ts` was **not** ported: it signs gateway requests with `node:crypto`,
which is server-side only. The native app calls the server's verify endpoints
instead.

## API contract notes

Two routes the web app uses don't exist as GETs, so the client adapts:

- **No `GET /api/courts`** — that route is POST-only. Courts come nested on the
  venue object, so `fetchCourts()` reads the venue and lifts them out.
- **No `GET /api/bookings/:id`** — only PATCH/DELETE. `fetchBooking()` reads the
  player's booking list (filtered by `userId`) and picks the matching id.

`venue.acceptedPayments` is a **comma-separated string** (`"eSewa,Khalti,Cash at
Venue"`), not an array — split and trim before comparing.

## Layout

```
app/                  expo-router screens
  _layout.tsx         providers + native stack
  index.tsx           entry redirect (auth gate)
  login.tsx signup.tsx
  (app)/              authenticated tabs: venues, bookings, account
  venue/[id].tsx      court + slot picker → create booking
  booking/[id].tsx    ledger + payment
src/
  api/index.ts        typed calls, one per route
  lib/                ported modules + the two RN seams
  context/            Auth + Theme providers
  components/ui.tsx   Button, Field, Card, Pill, Notice, Spinner
  theme.ts            emerald/slate tokens (matches the web palette)
scripts/smoke.ts      end-to-end test
```

## Theming

Light and dark palettes live in `src/theme.ts` as plain objects (RN has no
Tailwind). The values are Tailwind's emerald/slate ramps — the web app's accent
is emerald, verified by counting class usage. "System" follows the device and is
the default.
