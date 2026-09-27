# Futsal Nepal

The project is now split into two active services:

- `futsal-expo-app/` — Expo/React Native frontend.
- `laravel/` — Laravel 12 JSON API and application backend (SQLite locally, MySQL/MariaDB in deployment).

The Expo app is configured to use Laravel on port `8000` locally. Start the API
first, then Expo. The Laravel example environment uses SQLite and creates the
database file during migration, so no MySQL server or manual database creation
is required for a fresh development setup:

```bash
cd laravel
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate --seed
php artisan serve --host=0.0.0.0 --port=8000
```

In another terminal:

```bash
cd futsal-expo-app
npm install
cp .env.example .env
npm start
```

If you prefer MySQL/MariaDB, change the `DB_*` values in `laravel/.env` before
running the migration. Keep the API bound to `0.0.0.0` when using a phone or
another machine.

Set `EXPO_PUBLIC_API_BASE` for the device running Expo. Use
`http://localhost:8000` for an iOS simulator, `http://10.0.2.2:8000` for an
Android emulator, or the computer's LAN IP for a physical device.

## Development dataset

`php artisan migrate --seed` and `POST /api/seed` use the same deterministic
`Database\Seeders\RealWorldSeeder`. It creates a connected Nepal-based world
rather than a handful of generic demo rows: 18 venue owners, 120 players,
multiple courts at 20 venues, 24 squads with rosters and pending team
invitations/requests, bookings with ledger rows and team shares, open matches,
three leagues with entries/fixtures/payments/media, notifications, reviews,
promos and loyalty vouchers. The data includes both an everyday booking/open-
game flow and an in-progress league flow.

All seeded accounts use the password `futsal123`. Useful accounts for checking
both sides of the app are:

- Player: `aayush.adhikari@futsal.np`
- Venue owner: `prabin.shakya@futsal.np`

The seed is safe to run again: once `Satdobato Sports Village` exists it returns
its counts without adding another copy. To replace an older local dataset rather
than layering this one on top, use a clean development database:

```bash
cd laravel
php artisan migrate:fresh --seed
```

The endpoint returns `counts`, `seedVersion`, the example logins and two
scenario descriptions, which makes it easy to confirm that the API is serving
the Laravel dataset before opening Expo:

```bash
curl -s -X POST http://127.0.0.1:8000/api/seed
```

## Verification

```bash
cd futsal-expo-app
npm run typecheck
npm run smoke

cd ../laravel/tests/api
npm install
npm test
```

The former all-in-one web application is kept only as historical reference in
`react-expo-laravel-futsal-app/`. Neither active service imports it, reads its
files, or requires its database. It can be archived or removed once any desired
historical material has been retained.
