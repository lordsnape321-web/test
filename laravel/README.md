# Futsal Nepal — Laravel API

The standalone Laravel 12 backend for the Futsal Nepal Expo app. This service is
backend-only: there are no Blade pages, no Inertia frontend, and no dependency on
the retired web application. Every client-facing operation is JSON under
`/api`.

The Expo frontend lives in `../futsal-expo-app`. It talks to this service using
the API origin configured by `EXPO_PUBLIC_API_BASE` (port `8000` locally).

## Requirements

| | |
|---|---|
| PHP | ^8.2 with PDO and `pdo_mysql` |
| Composer | 2.x |
| Database | MySQL 8 or MariaDB 10.6+ |

MySQL is the required application database. Laravel is the only backend and
owns all schema, seed data, queries, writes, booking rules, payments, and API
logic; the Expo app never connects to MySQL directly.

## Getting started

```bash
cd laravel
composer install
cp .env.example .env
php artisan key:generate
mysql -u root -p -e "CREATE DATABASE futsal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
php artisan migrate --seed
php artisan serve --host=0.0.0.0 --port=8000
```

The copied `.env.example` is already configured for MySQL on `127.0.0.1:3306`
with database `futsal` and user `root`. Laravel also falls back to the `futsal`
database name when `DB_DATABASE` is missing, so it does not silently target the
standard `laravel` database. Change only those `DB_*` values if your MySQL
installation uses a different host, port, database, username, or password. Keep
`DB_CONNECTION=mysql`; do not switch the application to another database driver.

Check that the API answered:

```bash
curl -i http://127.0.0.1:8000/api/health
```

A healthy response is `200 {"ok":true}`. A database problem is a `503` JSON
response with an `error` message (and, in the copied local `APP_DEBUG=true`
environment, the underlying PDO message) instead of a misleading generic
failure. `POST /api/seed` is idempotent and can be used to top up an existing database.
If a newly added route answers 404, clear Laravel's cached route table:

```bash
php artisan optimize:clear
php artisan route:list --path=api
```

## Expo connection

The Expo client is already configured for this API. From
`futsal-expo-app/.env`, use the address visible from the device:

| Client | `EXPO_PUBLIC_API_BASE` |
|---|---|
| iOS simulator | `http://localhost:8000` |
| Android emulator | `http://10.0.2.2:8000` |
| Physical device | `http://<computer-LAN-IP>:8000` |

For an Expo web preview, Metro forwards same-origin `/api` requests to this
service. `CORS_ALLOWED_ORIGINS=*` is suitable for local development; list the
real web origins before production.

Payment return links are built from `APP_URL`, while app/deep-link return links
use `APP_WEB_URL`. Set both to the deployed API and app origins when publishing.

## Running the acceptance suite

All six live API suites are self-contained in `tests/api`:

```bash
cd tests/api
npm install
BASE_URL=http://127.0.0.1:8000 npm test
```

The runner defaults to `http://127.0.0.1:8000`, checks `/api/health` first, and
reads the configured database credentials from `laravel/.env`. The two ledger
suites also inspect database rows to verify gateway payments and settlement
locks; the other four are HTTP-only. No other project directory is required to
run these tests. The acceptance helper uses the same MySQL database configured
for Laravel, so use a MySQL/MariaDB `.env` when running the full suite.

## API contract

The endpoint paths and JSON response shapes are the contract consumed by the
Expo app. Requests currently carry the acting user's id in the query string or
JSON body, for example `GET /api/bookings?userId=3` and
`POST /api/notifications/read-all {"userId":3}`. The mobile client stores the
safe user object in AsyncStorage and sends the relevant id with each action.

Bearer-token authentication can be introduced later by changing the actor
resolution seam without changing route payloads. Controllers already keep
request validation and authorization separate from the persistence models.

## Project layout

| Layer | Location | Responsibility |
|---|---|---|
| HTTP | `app/Http/Controllers/Api` | Validate requests and shape JSON responses |
| Models | `app/Models` | MySQL records and response serialization |
| Rules | `app/Support` | Booking, ledger, loyalty, promo, team, and league policy |
| Services | `app/Services` | Booking presentation and notifications |
| Routes | `routes/api.php` | The complete `/api` surface |
| Schema | `database/migrations` | The 23-table application schema |
| Tests | `tests/api` | Live HTTP and database acceptance suites |

## Environment knobs

| Variable | Meaning |
|---|---|
| `APP_URL` | API origin used for gateway return URLs |
| `APP_WEB_URL` | Expo/web origin used in app return links |
| `CORS_ALLOWED_ORIGINS` | Comma-separated production web origins, or `*` locally |
| `SETTLE_EDIT_WINDOW_MINUTES` | Settlement correction window, five minutes by default |
| `ESEWA_*`, `KHALTI_*` | Gateway credentials; blank values enable local simulators |

## Tests

```bash
php artisan test
```

MIT License.

## Repair payment caches after the database restructure

The booking ledger reads `booking_payments` and `booking_extras` using Eloquent
attributes; database column names remain snake_case and the Expo JSON contract
remains camelCase. No schema reset or new migration is required for this fix.

### Normal local startup — no extra commands

With the existing dependencies, `.env` and restructured MySQL database already
set up, pull these changes and use your normal startup commands:

```bash
# In laravel/
php artisan serve

# In futsal-expo-app/, another terminal
npx expo start
```

Before Laravel starts listening, `serve` automatically checks and corrects the
cached payment statuses from saved receipts. It prints the corrections and logs
before/after values through Laravel's configured logger. It runs on each server
start, in batches with a transaction and booking lock per row; unchanged rows are
not written, and booking timestamps are preserved. There is no repair scan on
ordinary HTTP requests. A database/repair error stops startup visibly rather than
silently serving inconsistent payment state. MySQL must already be running.

No `migrate`, `optimize:clear`, `composer install`, or npm install is required for
this update. No dependencies or schema were changed. Keep a normal database backup.

For deployments not using `artisan serve`, the manual command is still available
(dry run by default); stop other payment writers before applying corrections:

```bash
php artisan bookings:reconcile-payments                 # dry run, no writes
php artisan bookings:reconcile-payments --booking=123   # inspect one booking
php artisan bookings:reconcile-payments --apply         # optional manual repair
```

This rebuilds payment/deposit/advance caches from existing ledger rows (team
collection totals remain based on team shares). It does not insert or delete
receipts, change booking approval/cancellation, or refund money. Expired advance
requests remain expired. If actual gateway receipts are missing from the database,
reconcile those against the provider's transaction history manually; a cached
`paid` flag is not proof of payment. Never use `migrate:fresh` to fix live payments.

Deploy the Expo changes too: each simulator checkout now has its own retry-stable
reference. Older clients using the shared `mock-pidx` can replay an old payment but
cannot reliably distinguish a new instalment. The checkout is still a **sandbox
simulator**, not a production-money integration.

Regression tests (use the dedicated `futsal_test` MySQL database configured in
`phpunit.xml`, never the live database):

```bash
vendor/bin/phpunit tests/Unit/BookingLedgerTest.php tests/Feature/BookingPaymentFlowTest.php tests/Feature/DevelopmentServerPreparationTest.php
```
