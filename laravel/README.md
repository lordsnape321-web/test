# Futsal Nepal — Laravel API

The backend for the Futsal Nepal Expo app, ported route-for-route out of the
Next.js app (`react-expo-laravel-futsal-app/`) into a standalone, **backend-only**
Laravel 12 service on **MySQL**.

There is no frontend here: no Blade, no Inertia, no session or cookie login.
Everything this app does is JSON under `/api`.

## Why this exists

The Expo app used to talk to the Next.js app's `/api` folder. That worked, but it
tied the mobile API to a web framework, a React build and a serverless runtime.
This directory is the same API, same paths, same JSON shapes and same status
codes — with the rules (booking windows, ledger maths, loyalty, leagues, promos)
moved into plain PHP classes the mobile app, the web UI and the tests can share.

**The HTTP contract is unchanged.** Every request keeps the shape the app already
sends — including authentication, which is still the acting player's id in the
query string or the body (`GET /api/bookings?userId=3`,
`POST /api/notifications/read-all {userId}`). Nothing in the Expo app has to
change to move over.

## Requirements

| | |
|---|---|
| PHP | ^8.2 |
| Database | **MySQL** 8 (or MariaDB 10.6+) |
| Composer | 2.x |

## Getting started

```bash
cd laravel
composer install
cp .env.example .env
php artisan key:generate
```

Point `.env` at your MySQL instance:

```dotenv
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=futsal
DB_USERNAME=root
DB_PASSWORD=
```

Then build the schema and load the demo data:

```bash
php artisan migrate        # 23 tables
php artisan db:seed        # or: curl -X POST http://127.0.0.1:8000/api/seed
php artisan serve
```

Check it answered:

```bash
curl http://127.0.0.1:8000/api/health
```

If a route you just added answers `404 … could not be found`, clear the route
cache — Laravel will happily serve a cached route table that predates it:

```bash
php artisan optimize:clear
php artisan route:list --path=seed
```

## Running the acceptance suite

The API suites are plain-HTTP node scripts, but they **live in the Next.js app**,
not at the repo root, and they are run by `tests/run.mjs` rather than directly.
From the repository root:

```bash
cd react-expo-laravel-futsal-app
BASE_URL=http://127.0.0.1:8000 npm run test:api
```

`BASE_URL` matters: it defaults to `http://127.0.0.1:3000`, the Next.js port, so
without it you would be testing the old backend.

Six suites run. Four of them (`court-delete`, `deposit-split`, `gateway`,
`venue-defaults`) are pure HTTP and work against this backend unchanged. The
other two — `ledger` and `settlement-lock` — open a second, direct connection to
the database with the `pg` driver to inspect and back-date rows the API doesn't
expose (`booking_payments`, `bookings.settled_at`). They will fail here until
they are pointed at MySQL; see `docs/api-routes.md` for the endpoints they
exercise in the meantime.

## Seeding `/api/seed`

Idempotent on purpose. Hitting it against a database that already has venues
*backfills* whatever a newer build added (password hashes, venue owners, reviews,
promo codes, squads) and answers `Already seeded` with a report of what it topped
up. Hitting it against an empty database builds the whole demo world: nine
players, six grounds, fourteen pitches, bookings, open games, five squads with
rosters and pending queues in both directions, reviews, promo codes and two
leagues — one open and owner-hosted, one private and player-hosted.

It is the same dataset `php artisan db:seed` produces, so a fresh checkout can be
populated either way.

## How the port is laid out

The Next.js app split its logic three ways, and so does this one:

| Next.js | Laravel | What lives there |
|---|---|---|
| `src/lib/*.ts` (pure rules) | `app/Support/*.php` | Arithmetic and policy — no database, no framework |
| `src/lib/*-store.ts` / `src/db` | `app/Support/*Store.php` + `app/Models` | Reading and joining rows |
| `src/app/api/**/route.ts` | `app/Http/Controllers/Api/*.php` | HTTP: validate → act → shape the reply |

`app/Support/` is the interesting half. `Futsal` (money formatting, slots, time),
`BookingLedger` (per-player splits, settlement, the edit window),
`AdvancePayment` / `LedgerRecord` / `Loyalty` (trust score, no-show rules,
vouchers), `Promos` (discount maths, windows), `Teams` (squads, consent, quotas),
`TeamStore`, `League` (tables, brackets, groups, the money lock) and `LeagueStore`
are ports of the TypeScript originals — same names, same numbers, so a bug fixed
on one side is a bug fixed on the other.

Two things were added, and they are the reason the port exists:

- **`app/Http/Middleware/ResolveActor.php`** — reads `userId` off the query string
  or the body and hangs the acting player off the request, so every controller
  asks `$request->input('userId')` and gets the same answer.
- **`app/Http/Controllers/Api/ApiController.php`** — the shared `ok()` / `fail()`
  helpers, so a 409 says "squad full 👥" with the same body everywhere.

## Authentication today, and the swap later

Today: the acting player's id travels in the request, exactly as it did in the
Next.js app. `ResolveActor` resolves it; controllers authorise against it.

Later: when the app is ready for bearer tokens, Sanctum is already installed as
the intended shape. The swap is one file — change `ResolveActor` to prefer
`$request->bearerToken()` (or `$request->user()`) and fall back to the `userId`
parameter for older clients. Because every controller already reads the actor off
the request rather than straight out of `$_GET`, no controller changes.

## Route inventory

82 endpoints across 47 route files, matching `docs/api-routes.md`:

| Area | Endpoints |
|---|---|
| Health, stats, availability | 3 |
| Auth (signup / login / reset / change-password) | 4 |
| Users, venues, courts | 9 |
| Bookings (+ ledger, team payments, payment requests) | 10 |
| Payments (eSewa, Khalti) | 4 |
| Open matches | 3 |
| Notifications | 5 |
| Vouchers, reviews | 4 |
| Squads, invites, requests, players | 20 |
| Leagues (tournaments) | 16 |
| Promo codes | 5 |
| Seed | 1 |

## Environment

`.env.example` is annotated. The knobs that change behaviour:

| Variable | Meaning |
|---|---|
| `SETTLE_EDIT_WINDOW_MINUTES` | How long a settlement stays editable (5, the same as the Next.js app) |
| `ESEWA_*`, `KHALTI_*` | Gateway credentials. **Unset = local simulator**: the initiate routes hand back a mock link instead of failing, so the app is fully testable offline |
| `PROMO_*`, `LOYALTY_*` | Discount ceilings and trust-score thresholds |

## Tests

```bash
php artisan test
```

## License

MIT.
