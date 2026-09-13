# FutsalNepal — futsal court booking app

A Next.js 16 (App Router) + Drizzle ORM + PostgreSQL app for booking futsal courts in Nepal: browse
venues, pick a court and time slot, book it, pay via eSewa/Khalti (simulated), join open matches,
manage a venue as an owner, and redeem **promo codes** for a discount at checkout.

---

## Quick start

> **Run these one at a time.** Pasting the whole block at once feeds the later lines to whatever
> command is still running, which silently aborts `db:push` and leaves you with an empty database.

```bash
cd react-expo-laravel-futsal-app
npm install
```

Create `.env` in this folder:

```bash
echo 'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db' > .env
```

Start Postgres (pick one — see [Database](#database) below), then:

```bash
npm run db:check    # confirms Postgres is reachable and tells you what is missing
npm run db:push     # create the 12 tables — must print "[✓] Changes applied"
npm run dev         # http://localhost:3000
```

Finally, seed demo data (venues, courts, users, bookings, promo codes):

```bash
curl -X POST http://localhost:3000/api/seed
```

### Demo logins

All demo accounts use the password `futsal123`.

| Role         | Email                | What you can do                                     |
| ------------ | -------------------- | --------------------------------------------------- |
| Venue owner  | `ganesh@futsal.np`   | Manage venue, courts, bookings, **promo codes**     |
| Venue owner  | `priya@futsal.np`    | A second owner, for testing ownership checks        |
| Player       | `aarav@futsal.np`    | Book courts, apply promo codes, join open matches   |

---

## Database

The app needs PostgreSQL 14+ and a database named in `DATABASE_URL`. Both the app
(`src/db/index.ts`) and the schema tooling (`drizzle.config.ts`) read the **same** `DATABASE_URL`
from `.env`.

**Option A — Docker (recommended, no local setup):**

```bash
docker run --name futsal-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=app_db \
  -p 5432:5432 -d postgres:16
```

This creates `app_db` with user/password `postgres`/`postgres`, matching the `.env` above.

**Option B — Postgres already installed (Debian/Ubuntu/Parrot/Kali):**

```bash
sudo service postgresql start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
sudo -u postgres createdb app_db
```

Then re-run `npm run db:check` to confirm the app can authenticate over TCP.

---

## Scripts

| Script                  | What it does                                                  |
| ----------------------- | ------------------------------------------------------------- |
| `npm run dev`           | Dev server on :3000 (Turbopack, the Next 16 default)          |
| `npm run dev:webpack`   | Dev server on the webpack bundler instead — see troubleshooting|
| `npm run build`         | Production build                                              |
| `npm run build:webpack` | Production build with webpack                                 |
| `npm start`             | Serve the production build                                    |
| `npm run db:check`      | Diagnose connectivity, missing database, un-pushed schema     |
| `npm run db:push`       | Push `src/db/schema.ts` to the database (drizzle-kit)         |
| `npm run typecheck`     | `tsc --noEmit`                                                |
| `npm run lint`          | ESLint                                                        |

---

## Troubleshooting

### Every API route returns 500, pages render empty

Almost always the database: either Postgres is not running, the database does not exist, or
`db:push` never completed. Run:

```bash
npm run db:check
```

It prints the exact cause and the command to fix it. Since API handlers log the underlying error,
your `npm run dev` terminal will also show lines like:

```
[/api/venues GET] failed: error: relation "venues" does not exist
```

`relation "..." does not exist` means the schema was never pushed → `npm run db:push`.
`ECONNREFUSED` means Postgres is not running → start it.

### "Specified module format (CommonJs) is not matching … EcmaScript Modules"

A Turbopack module-format error on `src/app/layout.tsx`. Usually a stale build cache or a stray
`package.json` somewhere **above** the app folder that Turbopack adopts as the project root.

```bash
rm -rf .next          # Windows: rmdir /s /q .next
npm run dev
```

If it persists, check for an ancestor `package.json` and rename it out of the way:

```bash
d="$(pwd)"; while [ "$d" != "/" ]; do
  [ -f "$d/package.json" ] && echo "$d/package.json"
  d="$(dirname "$d")"
done
```

`next.config.ts` already pins `turbopack.root` to the app folder, which prevents Turbopack from
walking up past it. As an immediate workaround you can also bypass Turbopack entirely:

```bash
npm run dev:webpack
```

Two related gotchas: Next 16 allows only **one dev server per project folder**, and `.next` must be
deleted when **switching between Turbopack and webpack**, since they share that directory.

---

## Promo codes

Owners create percentage or flat-rate codes with a validity window, optional usage cap, and optional
minimum spend. Players apply a code on the venue page and see the discounted total before booking;
the discount is re-validated server-side when the booking is created, so a stale or tampered client
cannot get a discount it is not entitled to.

- `src/lib/promos.ts` — pure promo logic (normalisation, validity window, discount maths)
- `src/lib/promo-store.ts` — database access for promos and their usage counts
- `src/app/api/promos/` — CRUD, owner-gated; usage is derived from bookings, not a counter column
- `src/components/PromoManager.tsx` — owner UI (admin → venues → Promos tab)

Promos stack with loyalty free-play vouchers: free play is applied first, then the promo discount to
whatever balance remains. When free play covers the whole booking, promos are blocked.

> Note: the separate `vouchers` table is the loyalty free-hour system — it is **not** promo codes.

---

## Booking for a squad ("Just our gang")

Step 4 of the booking flow asks whether the game is **Just our gang** (private) or **Invite
everyone!** (an open listing others can join). Both branches can name a squad:

- **Player belongs to teams** → chips list every team they are in, captained squads first, each
  showing its member count. A "Just me" / "Just friends" chip books without attaching a team.
- **Player belongs to no team** → no picker is rendered. The booking stays an *individual booking*
  with a link to `/teams` to find a squad, because an empty picker with one dead chip is worse than
  no picker at all.

Choosing a squad on an open invite also syncs the crew size to the real squad and names the team on
the public listing, so joiners know whose crew they are walking into.

Membership is verified server-side in `POST /api/bookings` — a hand-edited request cannot attach a
booking to a team the player does not belong to. The team **name is snapshotted** onto the booking
(the same way `promoCode` is), so bookings keep their label if a team is later renamed or deleted.
The squad then appears as a badge on the player's bookings and on the owner's request/booking
screens, and in the owner's booking-request notification.

- `src/lib/team-store.ts` — `teamsForUser()` for the picker, `findTeamForUser()` for the authority check
- `GET /api/teams?userId=N` — that player's squads only; no parameter returns every team with full
  rosters, as before

Demo data covers both paths: `aarav@futsal.np` captains one squad and is in two more, while a freshly
signed-up account is in none.
