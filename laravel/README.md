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
| PHP | ^8.2 |
| Composer | 2.x |
| Database | MySQL 8 or MariaDB 10.6+ |

SQLite can be used for a quick local run by changing `DB_CONNECTION` and
creating `database/database.sqlite`, but MySQL is the supported deployment
configuration.

## Getting started

```bash
cd laravel
composer install
cp .env.example .env
php artisan key:generate
```

Configure the database in `.env`:

```dotenv
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=futsal
DB_USERNAME=root
DB_PASSWORD=
```

Build the schema and load the demo data:

```bash
php artisan migrate --seed
php artisan serve --host=0.0.0.0 --port=8000
```

Check that the API answered:

```bash
curl http://127.0.0.1:8000/api/health
```

`POST /api/seed` is idempotent and can be used to top up an existing database.
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
reads MySQL credentials from `laravel/.env`. The two ledger suites also inspect
MySQL rows to verify gateway payments and settlement locks; the other four are
HTTP-only. No other project directory is required to run these tests.

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
