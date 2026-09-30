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

## Email (Gmail)

Booking confirmations, game reminders and password-reset codes are sent from
this service over SMTP. Gmail needs an **App Password** — a normal Google
account password is refused by SMTP, and Google only issues app passwords for
accounts with 2-step verification:

1. Turn on 2-step verification: <https://myaccount.google.com/security>
2. Create an app password: <https://myaccount.google.com/apppasswords>
3. Put the address and the 16-character password in `laravel/.env`:

```ini
MAIL_MAILER=smtp
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=youraddress@gmail.com
MAIL_PASSWORD=abcdefghijklmnop
MAIL_ENCRYPTION=tls
MAIL_FROM_ADDRESS="${MAIL_USERNAME}"
MAIL_FROM_NAME="Futsal Nepal"
```

Filling in `MAIL_USERNAME` is enough on its own: `config/mail.php` switches the
default mailer from `log` to `smtp` as soon as credentials exist. With no
credentials every email is written to `storage/logs/laravel.log` instead, so a
fresh clone works with nothing to configure. `php artisan optimize:clear` after
editing `.env` if the old values seem to stick.

Check what the API thinks:

```bash
curl -s http://127.0.0.1:8000/api/health
```

```json
{"ok":true,"build":"…","mail":{"configured":true,"driver":"smtp","from":"youraddress@gmail.com","pending":0}}
```

### How mail is delivered without a queue worker

The whole workflow is `git pull`, `php artisan serve`, `npx expo start` — no
queue worker, no scheduler. So:

* every message is written to the **`email_outbox`** table inside the request
  that caused it (a booking confirmation never waits on Gmail);
* `App\Http\Middleware\PumpOutbox` drains up to two messages *after* the
  response is sent, on ordinary API traffic — the app polls, so the gap is
  milliseconds;
* the same middleware scans for games starting soon, throttled to once every
  five minutes, so `bookings.reminder_sent_at` is what guarantees exactly one
  reminder per game;
* failures retry twice (5 and 10 minutes later) and are then parked as
  `failed` with the SMTP error in `email_outbox.error`.

Each request drains at most two messages and five seconds' worth, because
`php artisan serve` handles one request at a time — a long SMTP conversation
would stall the next call. A backlog therefore clears over the following
requests, which arrive constantly while the app is open (it polls). `GET
/api/health` reports `mail.pending` if you want to watch the queue empty, and
`email_outbox.error` says why anything did not go out.

What goes out:

| Email | Trigger | Preference |
|---|---|---|
| Booking request / confirmed / declined / cancelled | the booking status changes | Booking emails |
| Payment news (deposit, advance, team share) | ledger writes | Booking emails |
| Squad invitation, match join | team/match actions | Booking emails |
| Game reminder (venue, court, kick-off, reference) | `reminder_minutes` before kick-off, default 2 hours | Game reminders |
| Password reset code | `POST /api/auth/forgot-password` | always sent |
| Password changed receipt | any password change | always sent |
| Welcome | account creation | always sent |

Players control the first two in the app (Settings → Alerts → Email →
`PATCH /api/users/{id}` with `emailNotifications`, `emailReminders` and
`reminderMinutes`). Password and security mail ignores the switches on purpose:
someone locked out of their account must still get their code.

### Password reset by email

`POST /api/auth/forgot-password {"email":"…"}` emails a six-digit code and
always answers the same way, whether or not the address has an account (so the
endpoint cannot be used to enumerate users). The code lives 15 minutes, dies
after five wrong guesses, and is limited to one a minute and five an hour per
address. `POST /api/auth/reset-with-code {"email","code","newPassword"}` spends
it. Codes are stored only as a salted SHA-256 digest.

The older phone-verified path (`POST /api/auth/reset` with email + phone) still
works and is still what the recovery screen offers as a fallback.

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
| `MAIL_*` | Gmail/SMTP transport for confirmations, reminders and reset codes |
| `MAIL_TIMEOUT` | Seconds before an SMTP attempt gives up, 8 by default |

## Tests

```bash
php artisan test
```

MIT License.

## Repair payment caches after the database restructure

The booking ledger reads `booking_payments` and `booking_extras` using Eloquent
attributes; database column names remain snake_case and the Expo JSON contract
remains camelCase. The payment calculation fix requires no schema reset. The guest-ledger extension adds one new table (see below).

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

No extra `migrate`, `optimize:clear`, `composer install`, or npm install command is
required for local `artisan serve` startup. The guest-ledger migration below is
applied automatically before reconciliation. No dependencies change. Keep a normal database backup.

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

### Player booking details: venue advance and teammate contributions

The full booking detail screen displays the owner's saved advance, venue receipts,
remaining advance and deadline. The booking player can pay the remaining advance
personally (separate from their own team share), or select members of the booking's
team and request an amount from each. Bookings without a linked team offer self-pay
only. Pending requests can be cancelled without deleting their history.

Persistence uses the existing tables, with no migration or dependency install:
- `bookings`: owner's requested amount, deadline origin and verified advance status.
- `booking_payment_requests`: recipient, amount, purpose, payment method, status,
  paid amount and transaction reference; notifications are saved too.
- `booking_payments`: verified money received by the venue, including payer and gateway.
- `booking_team_payments`: the payer's contribution toward their share, capped at
  that share; paying more than one's share does not mark someone else's share paid.

Requests and verification are serialized using the booking lock. Partial receipts
reduce the advance still due; captain-held cash does not. Requests that no longer
fit the outstanding advance are cancelled, and stale checkout amounts are rejected
instead of silently charging a different amount. Self-pay and teammate pay continue
to use the existing sandbox checkout; this does not enable production payments.

Regression coverage: `vendor/bin/phpunit tests/Feature/TeamAdvancePaymentTest.php`.


### Player ledger: team shares, open spots and walk-in guests

Full Booking Detail → **Player payment details → Open player ledger** is available
for the booking organizer, including public bookings without a team. Paid teammates
appear immediately from their existing share/receipt records; the client does not
need to record those payments again. Rows identify captain collections, payments
to the venue, stored share payments and open-spot contributions. Direct payments
without an individually attributed historical receipt are labelled as stored share
payments rather than fabricated gateway receipts.

Accepted open-spot joins on this booking's linked matches are listed with their
fees, payment methods and payment status. Paid declined/cancelled joins remain as
history; an unpaid pending request is not an accepted player. Open-spot records
stay in `match_joins` and are never copied into the venue ledger. Open-spot guests
are not granted access to the squad's private finances by being listed here.

The organizer can add an **unregistered guest payment** with player name, method
and whole-rupee amount. These are collections by the organizer, stored in
`booking_guest_payments`, not fake user accounts or venue receipts. Guest totals
are separate and cannot erase another player's outstanding share. Undo marks a
row voided with the actor/time and keeps it in history. Registered gateway and
open-spot rows are read-only in this panel; their existing source workflows own
any correction. Voiding a captain entry subtracts only that entry's contribution,
not the player's gateway payments.

`php artisan serve` automatically applies only the additive migration
`2026_09_30_000029_create_booking_guest_payments_table.php` if its table is missing,
then runs payment-cache reconciliation. An existing database and migrations table
are required, as before. A normal `php artisan migrate` also discovers it for
non-serve deployments. No existing tables are reset or altered. The database user
must have permission to create the guest table. If creation fails startup stops
visibly. Normal HTTP requests do not run migrations.

Regression coverage: `vendor/bin/phpunit tests/Feature/ParticipantLedgerTest.php`.

### Reimbursing the organizer after they pay the bill

The player ledger separates the two facts that used to be conflated:

- **Money that reached the venue** — `booking_payments` rows, shown as “Paid to
  venue” (e.g. the organizer's own eSewa advance or balance payment).
- **Money reimbursed to the organizer** — `team_ledger_entries` rows, shown as
  “Reimbursed to you”.

Because the per-player share projection (`booking_team_payments.paid_amount`) is
not proof that a teammate paid anything, “record reimbursement” is measured
against receipts instead: a teammate can still be collected from when the
organizer covered the whole bill, and is *not* collected again when they paid
the venue directly. The cap is `share − paid to venue by that player − already
reimbursed`. A mistyped entry can be corrected with the **Edit** action (the
amount changes, the row survives) instead of being voided and re-entered, and
no action can push a share above what it is worth.

**Ask to pay** appears beside every listed player in Full Booking Detail's
“Player payment details” (and inside the ledger panel). It persists one
`booking_payment_requests` row and picks the purpose from where the money is
owed:

| Situation | Purpose | How the teammate settles |
| --- | --- | --- |
| Venue advance still unpaid | `advance` | eSewa or Khalti to the venue |
| Venue balance still open | `booking` | eSewa or Khalti to the venue |
| Organizer already paid the venue | `reimbursement` | Directly with the organizer; recorded in the ledger |

Reimbursement requests are saved, notified and cancellable like any other
request, but they can never open a gateway: the venue is already paid, so the
verify and method endpoints answer 409 and the teammate's screen explains that
the money goes back to the organizer.

The owner's advance card, the squad list and these actions live inside Full
Booking Detail and are visible without a Show/Hide tap; the booking organizer
sees them for public/open bookings too (a team link is only required to ask
teammates, not to read the ledger).

### Live updates (no manual reload)

Every screen that shows money now re-reads itself on a timer while it is
focused, so a teammate paying from another phone (or the owner answering a
request) appears without navigating away and back:

| Screen | Interval |
| --- | --- |
| Full Booking Detail (`app/booking/[id].tsx`) | 4 s |
| My Bookings (`app/(app)/bookings.tsx`) | 4 s |
| Player ledger panel (team, open spots, guests) | 4 s |
| Owner Studio dashboard, bookings and requests | 5 s |

Polling pauses when the app is backgrounded, when the screen is not focused,
while a checkout or ledger write is in flight, and while the ledger panel (which
polls on its own) is open. A refresh requested during an in-flight load is
queued, so a just-completed action can never be overwritten by a poll that
started before it; background poll failures are silent and keep the last good
data on screen. The server response remains the only source of truth — nothing
is patched into local state.

### Adding a team after booking ("Just us" mistake)

Booking without picking a squad used to be final: the booking stayed solo, so the
equal split, the player ledger and every teammate request stayed unavailable. The
booker can now attach one of their teams afterwards, from either:

- **My Bookings → Coming up → Select team 👥** (a picker sheet lists the squads
  they belong to), or
- **Full Booking Detail → Booked without a team? → Select team**.

`PATCH /api/bookings/{id}` with `{ actor: "player", actorId, teamId }` validates
that the caller is the booking's player and a member of that team, refuses closed
bookings, then splits `total_price` across the roster with the same rounded
equal-share rule as checkout (`booking_team_payments`), sets `team_id`/
`team_name`, and notifies each teammate with their share. Money a player has
already sent the venue is attributed to their new share instead of showing as
unpaid; rows for players no longer on the roster are only removed while nothing
has been paid on them. Attaching the same team twice is a no-op.

Once the squad is attached, the existing features light up unchanged: share
payment methods, **Ask to pay** / **Ask teammates to pay their contribution**,
the player ledger (team shares, open spots, guest collections) and reimbursement
tracking. Swapping the team after any share has money recorded is refused (409),
because re-splitting would silently rewrite who owes what.

Regression coverage: `vendor/bin/phpunit tests/Feature/BookingTeamAttachTest.php`.

### Per-court opening hours

Each court can now carry its own window (Owner Studio → Venue → Edit court →
**Opens at / Closes at**, half-hour steps). `courts.opens_at` / `courts.closes_at`
are nullable `"HH:MM"` strings; leaving them empty means "follow the venue", which
is exactly the behaviour every court had before, so nothing changes for venues
that never touch the new fields.

The hours are not decoration — they decide what players can book:

- **Player app**: the slot picker for a court is generated from that court's
  window (`courtTimeSlots` in `src/lib/futsal.ts`), falling back to the venue's
  `opening_hour`/`closing_hour`. The booking screen and the court list show the
  window being used.
- **API**: `POST /api/bookings` refuses a start/end block outside the court's
  window with `This court is open 06:00–22:00 — pick a slot inside those hours ⏰`.
  Previously such a game was happily created and then cancelled by the owner.

`POST/PATCH /api/courts` validate the pair with `Validation::clockRange` — both
hours or neither, close after open, at least an hour of play — and blank strings
clear a court back to the venue's hours. The column pair arrives with the
`court_opening_hours` startup migration (`StartupSchema`), so a plain
`php artisan serve` applies it like the other additive schema steps.

### Hours for one weekday only

The usual window covers every day. When a single day differs — the turf that runs
late on Fridays only — the owner opens **Different hours on some days?** in the
court modal and changes that day; every row left alone keeps the usual window.

Day overrides live in `court_day_hours` (`court_id`, `day_of_week`, `opens_at`,
`closes_at`, unique per court/day; 0 = Sunday, matching JavaScript's `Date.getDay`).
A request may send `dayHours: [{ dayOfWeek: 5, opensAt: "18:00", closesAt: "23:00" }]`
on `POST`/`PATCH /api/courts`; the list replaces whatever was stored, so an empty
list clears every override. Each entry must be a complete window (`clockRange`),
which is why half a window is rejected rather than read as "opens at 18:00".

The weekday wins over the court's usual hours everywhere: booking validation, and
the player app's slot picker, which now regenerates from the hours of the day being
booked (`courtTimeSlots(court, venue, date)`). The booking refusal names the day:
`This court is open 18:00–23:00 on Fridays — pick a slot inside those hours ⏰`.

### Opening a venue in Maps

Owners paste a Google Maps share link in **Venue → Edit all → Location link**. It
is stored as `venues.location_url` and travels with the venue (and with every court
inside it, since a court has no address of its own).

Players — and the owner — tap a venue's location and it opens:
the pasted link when there is one, otherwise a Maps search on `address, city`
(`mapsUrl()` in `futsal-expo-app/src/lib/location.ts`). Tappable locations exist on
the player venue page, the full booking detail, the My Bookings card, the owner's
venue profile card and each court row.

Regression coverage: `vendor/bin/phpunit tests/Feature/CourtHoursTest.php` (hours,
day overrides and the map link) plus the `node` probes
`futsal-expo-app/scripts/court-hours.test.ts` and `scripts/location.test.ts`.
