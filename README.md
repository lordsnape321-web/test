# Futsal Nepal

The project is now split into two active services:

- `futsal-expo-app/` — Expo/React Native frontend.
- `laravel/` — Laravel 12 JSON API and MySQL application backend.

The Expo app is configured to use Laravel on port `8000` locally. Start the API
first, then Expo:

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

Set `EXPO_PUBLIC_API_BASE` for the device running Expo. Use
`http://localhost:8000` for an iOS simulator, `http://10.0.2.2:8000` for an
Android emulator, or the computer's LAN IP for a physical device.

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
