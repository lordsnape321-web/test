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
npm run db:push     # create/refresh the schema — must print "[✓] Changes applied"
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

**If `npm run db:push` stops and asks about truncating a table, answer `No`.** drizzle-kit compares
`src/db/schema.ts` with the live database, and a change it cannot make safely on a table that already
has rows — adding the `UNIQUE` index on `teams.team_code` is the one to watch — makes it print
something like `You're about to add a unique constraint to team_code ... Do you want to truncate
teams table?` and wait for `y/N`. `--force` does **not** skip that prompt. Answering `No` still
applies the constraint: `UNIQUE` allows NULLs, so teams created before the column existed are fine,
and `POST /api/seed` backfills a generated code for any team missing one. Only answer `y` if you
genuinely want the rows gone. A fresh clone never sees the prompt, because its tables are empty.

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

## Leagues: three ways to decide a winner — and the money locks at kick-off

**Picking the shape.** Hosting a league starts with one question: *how does this decide a
winner?* (`mode` on `tournaments`, `LEAGUE_MODES` in `src/lib/league.ts`).

| Mode | What the host gets | How the draw is built |
| --- | --- | --- |
| `round_robin` 🔄 | One table, everyone plays everyone once | Every pairing once, `round: "League"`, re-drawing skips pairs already on the book |
| `knockout` 🥊 | A bracket: quarter-finals, semis, final (+ optional 🥉 third place) | `bracketSizeFor()` rounds the field up to 8/16/32, `seedOrder()` seeds 1-v-8 / 4-v-5 style, the surplus slots are **byes** for the top seeds |
| `group_knockout` 🎯 | Groups first, then a bracket for the qualifiers | `makeGroups()` snake-drafts the squads into groups of `groupSize` (never a group of one); the top two of each group feed `knockoutFromGroups()` |

The hosting form shows a live hint of what the draw will be — "a bracket of 8: 5 squads, 3 byes" —
using the same arithmetic the server runs, so the promise and the fixture list cannot disagree.
`groupSize` is bounded by `MIN_GROUP_SIZE`/`MAX_GROUP_SIZE` and checked by `groupSetupError()` on
both sides.

**The bracket is data, not decoration.** Each fixture carries `bracketRound`, `slot` and a
*ref* per side — `W2-0` (winner of round 2 slot 0), `L2-1` (loser, for the bronze game), `G1W` /
`G2R` (group 1 winner / group 2 runner-up). `advanceBracket()` walks those refs after every score
and fills the downstream slots, so scoring the last group game promotes two squads into the
semi-finals without anyone touching the fixture book. Refs are round-relative on purpose: the
semi-final is round 1 in a 4-team bracket and round 2 in an 8-team one, so nothing is hardcoded.
A knockout game cannot be drawn level (`400` — count the penalties), and `winnerOf()` returns 0
for a level or voided game so a slot never fills with a guess. The host can also nudge it by hand
with `action: "advance"`, set kick-offs with `action: "schedule"` (works on empty slots too, so
"final, Saturday 7:30 PM" can be on the card before the finalists exist), and cannot delete a
bracket game at all. `PATCH /api/tournaments/{id}` answers `409` if the host tries to change
`mode` once fixtures are drawn.

**The money lock 🔒.** The refund promise — "back out and a tenth of your entry fee comes back"
— is true right up until the squad's **first kick-off**, and then it is over. `moneyLockedFor()`
in `src/lib/league.ts` says a squad has played when it has a result on the board *or* one of its
fixtures has a kick-off time behind it (a voided fixture does not count — nobody played it).
That covers every way a season ends for a squad: knocked out in the quarter-final, last in the
group, or champion. From that moment `withdraw` answers `409` with the reason spelled out,
`refundable` is 0, and the captain's panel swaps the red **Withdraw** button for **Entry locked —
you've played**. The host can still remove a squad, but with `refund: 0`, and the chip says so
before they click. A fixture still in the future locks nothing — walking away before the first
game works exactly as advertised.

One wrinkle worth knowing: a squad that backs out, takes its refund and then re-enters keeps the
old `refundedAmount` on its entry row, so `paymentState()` takes the entry `status` and only reads
**Backed out — part refunded** when the squad really is withdrawn.

**Paying the entry fee.** A squad entering a league picks a medium the same way a player booking a
pitch does — 💚 eSewa, 💜 Khalti or 💵 Cash at venue (`payMethod` on `tournament_teams`). Online
picks go out to a checkout: `action: "initiate"` on the payments route returns eSewa's signed
form-post fields or Khalti's `payment_url`, with a league-aware reference (`LG-{league}-{team}-…`
from `makeLeagueEsewaUuid`/`makeLeagueKhaltiOrder`, so a callback can never be confused with a
booking's) and the same local-simulator fallback the booking gateways have. When the checkout comes
back, `action: "verify"` writes the ledger row, stores the gateway txn, and — because paying the
deposit *is* accepting an invitation — flips an invited squad to approved. Cash moves nothing here:
the host records it, and the captain can attach a screenshot (`action: "receipt"`) that the host
opens from the entry desk before approving.

**No amount may exceed what is owed.** The entry fee is a ceiling in three places, because the
ledger, the deposit gate and the 10% refund maths all believe whatever lands in `paidAmount`:
`clampAmountInput()` in `src/lib/league.ts` keeps the host's "Record cash" box inside the remaining
balance as you type, `action: "record"` refuses more than the squad owes (`400`), and
`action: "pay"` has always refused it too. An entry that is settled has nothing left to record.

**Adding a fixture.** The host's "Add a fixture" form lists the approved squads twice — home and
away — and each list hides whoever is already picked on the other side, so a squad can't be
selected against itself. The server refuses that anyway (`400 A squad can't play itself 🙂`), but
the option shouldn't have been there to click.

**Match photos.** Album photos are stored as data URLs on the league row, so there is no file on a
server to link to — the bytes are already in the browser, and `src/lib/download.ts` does the rest.
Each photo has its own download button (on the tile and in the preview), and **Download all**
builds a single `.zip` in the browser: photos are already-compressed JPEGs, so the ZIP is *stored*
rather than deflated, which loses nothing and needs no dependency — and one file beats firing
twenty anchors at once, which Chrome blocks after the first couple. Album links can't be zipped,
so they go in as `album-links.txt`.

---

## One review per player per venue — and a played game is locked

**Reviews.** A player gets a single review at each venue, however many games they play there.
The first one inserts a row; every later one *updates that same row* — rating, message and the
game it was written from — so a venue page never shows an old and a new review from the same
person (`POST /api/reviews` returns `200 { updated: true }` instead of `201`). Writing one still
requires having actually played there. Once written it is **locked**: `DELETE /api/reviews`
answers `403`, and the card shows a padlock instead of a bin. Playing another game at that venue
reopens it for an update, which is why the bookings card says **Update review ⭐** rather than
**Review ⭐** once you have reviewed that venue.

**Played games.** "Played" has one definition, shared by the API and the UI as `gamePlayed()` in
`src/lib/futsal.ts`: `completed`, or `confirmed` with the end time behind us. A `pending` or
`rejected` request never counts — that game never happened, so it does not appear in the
**Played** tab of *My games* either.

A played booking is **locked**: the card drops the cancel / pay / add-receipt controls and shows
**Game played • locked**, and the same rule is enforced server-side — `PATCH /api/bookings/{id}`
and `DELETE /api/bookings/{id}` answer `409` for a player touching `status`, `paymentStatus`,
`paymentMethod`, `depositStatus` or `receiptUrl`, and both gateway `initiate` routes refuse to
start a payment. The **venue owner is exempt**, because marking a game completed, settling a
payment and recording a competition score all happen *after* kickoff.

The green "who's coming" panel (crew / joined / open spots, progress bar, link) no longer renders
on booking cards — a finished game has nobody left to come. That live headcount belongs to the
competition screen at `/matches`.

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

---

## Teams: one captain, one code, one home turf — and nobody joins without consenting

`/teams` is where squads are found and run. Four rules are enforced in the schema and the API, not
just hidden behind the UI: one captain, a unique code, a real home turf, and consent in both
directions (see below).

**1. Exactly one captain.** `teams.captain_id` is the source of truth, and every captain is also a
member. The member row's `role` label is kept in step with it by `transferCaptaincy()`, which demotes
every `captain` row and then promotes the new one — never two captains, never zero. Handing over the
armband is the only way to move it, and the new captain must already be in the squad. A captain
cannot step away while holding it: `DELETE /api/teams/{id}/join` answers `409` and says so.

**2. A unique, searchable code.** Every team carries a `team_code` like `CHARGERS-4X7K` — letters,
numbers and dashes, 4–24 chars, no spaces — stored uppercased behind a `UNIQUE` index. The captain
types one or hits the dice button to generate it from the team name; a code that is already taken is
refused with `409 codeError: "taken"` on both create and edit. `GET /api/teams?q=` matches codes
case-insensitively (exact first, then prefix) and falls back to a name search, so reading a code out
loud over the phone is enough to find a squad.

**3. Home turf comes from the platform.** `teams.home_venue_id` points at a real row in `venues` and
`teams.home_ground` snapshots that venue's name for display. Both the create form and the captain's
edit form offer a **dropdown of venues**, and a free-text turf in the request body is ignored
server-side — a team can never claim a court that does not exist.

### Joining is consent-based — in both directions

Nobody is ever added to a squad without saying yes. There are two queues, one per initiator, and
both are settled by the person who has to play with the newcomer:

| Direction | Filed in | Who answers | The answer creates the roster row |
| --------- | -------- | ----------- | --------------------------------- |
| Player asks to join | `team_requests` | the **captain** | `POST /api/teams/{id}/requests` with `action: accept` |
| Captain invites a player | `team_invites` | the **player** | `POST /api/team-invites` with `action: accept` |

Asking to join files a request; it does **not** add you to the squad. Re-asking after a decline
reuses that declined row instead of stacking duplicates, and the player can withdraw a pending
request — the same `DELETE /api/teams/{id}/join` endpoint handles both leaving and withdrawing.
Inviting works the same way in reverse: `POST /api/teams/{id}/invites` files the invitation, it sits
in the player's inbox, and only their accept (`/api/team-invites`) writes the membership. A decline
or a withdrawn invite can be reopened later; an accepted one is settled.

The captain used to be able to add someone straight to the roster and that write is gone:
`POST /api/teams/{id}/members` answers `405 consent_required` and points at the invite endpoint, so
no client — including an old one — can put a name on a squad without consent.

### Five asks a day, each way

`TEAM_INVITE_DAILY_LIMIT` and `JOIN_REQUEST_DAILY_LIMIT` (both **5**) cap how many invitations a
squad may send and how many join requests a player may file **per calendar day**, counted on the
row's `createdAt` — a reopen that fires today burns today's slot. The day is the server's, so the
count resets at midnight. The point is symmetry: a captain cannot carpet-bomb the roster, and a
player cannot flood every captain with the same message. Quotas are per *team* and per *player*, not
per captain, so captaining two squads does not double either limit.

Both numbers ride along on the responses the UI already makes (`GET /api/teams` returns
`invitesLeftToday` for squads you captain and the viewer's `quota`), so the pages say
**"3 of 5 invites left today"** before the fifth tap instead of failing after it. A 6th attempt gets
`429 { reason: "daily_limit", quota, resetsAt }`.

Answering is never capped — reading your inbox and saying yes costs nothing.

### Only players can be invited

`GET /api/users?role=player` is what feeds the captain's invite search, so venue owners and admin
accounts are not listed as recruitable at all; `POST /api/teams/{id}/invites` then re-checks the
role and answers `403 not_invitable` for anything that is not a player. Hiding them in the list is a
courtesy, refusing them on the server is the rule.

### The team's description

`teams.description` is the optional **"about us"** box: who plays, when the squad meets, how the
court bill gets split. It is a `textarea` on the create form and in `TeamManager`, validated at up
to `TEAM_DESCRIPTION_MAX` (400) characters, and it renders under the motto on every team card — the
one paragraph that helps a stranger decide to ask, and helps a captain decide to accept. A card has
to fit a dozen squads on one screen, so there it is clamped to three lines; on `/teams/{id}` it is
printed whole, `whitespace-pre-line`, paragraph breaks and all.

`GET /api/teams?viewerId=N` computes each team's relationship to that viewer server-side
(`isMember`, `isCaptain`, `requestStatus`, `requestId`, `inviteStatus`, `inviteId`, plus
`pendingRequests` / `pendingInvites` counts), so the cards draw honest buttons — **Manage your
squad**, **Accept & join** when a squad has invited you, **Request pending ⏳ — tap to withdraw**,
**Take a break from team**, or **Request to join** — rather than guessing from the roster.

### Nothing worth reading lives only in a dialog box

A request used to be answerable only inside a cramped modal: one line of name, one line of
`level • position`, and a note clamped to two lines. Both sides of that consent now have a real,
shareable page instead of an overlay — which also means a notification can land you on the thing
itself:

| Page | For | What it shows |
| ---- | --- | ------------- |
| `/players/{id}` | the **captain** reading a request (or an invite they sent) | the player's level, position, home city, reliability rating, trust badge, matches organised and joined, the venue reviews they wrote, every squad they already play for, and — if they asked or were invited — **Accept / Decline / Withdraw right there**, so deciding does not mean hunting for the panel |
| `/teams/{id}` | the **player** reading an invitation (or any squad they are eyeing) | the full description, W/D/L and win rate, squad size, home turf linked to the venue, the captain's name linked to their dossier, the whole roster as links, and the button that matches where the viewer actually stands |

Both are read-only `GET`s that reuse the existing write endpoints, so no new decision path — and no
new quota loophole — exists outside `/api/teams/{id}/requests` and `/api/team-invites`. Names are
wired to them from the team cards, the invite inbox, the roster, and every request/invite row in
`TeamManager`.

`GET /api/players/{id}` is deliberately blunt about privacy: no email, no phone, no booking rows,
even for a captain. The request and invite history it *does* return (`myQueue`) is filtered
server-side to squads the `?viewerId=` actually captains — re-checked with `isCaptain()`, not trusted
from the query string — and `captainOptions` (squad size, invites left today, whether this player is
already in or pending) is computed only for teams that viewer leads. An anonymous visitor gets the
same public profile anyone else sees, and the page says so rather than showing a dead button.

Team notifications now deep-link instead of dumping you on a list: **"Himal Basnet asked to join"**
opens `/players/8` for the captain; **invites, acceptances and declines** open `/teams/{id}` so the
player reads the squad before answering, and the captain sees the new name in the roster.

### The captain's panel

**Manage your squad** appears only on teams you captain and opens `TeamManager`: decide join
requests, invite players from a search that lists players only (with each open invitation and its
status underneath, withdrawable until answered), remove members (never yourself while you captain),
hand over the armband, and edit the name, description, motto, level, colours, squad size, code, home
turf and looking-for-players flag. Every action re-checks captaincy on the server, so hiding a button
is a courtesy rather than the security.

| Endpoint                                        | What it does                                                    |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `GET /api/teams?q=&viewerId=`                    | search by code or name, with the viewer's relationship to each team |
| `POST /api/teams`                                | create a team; `409` if the code is taken                        |
| `PATCH /api/teams/{id}`                          | captain-only edit; `newCaptainId` transfers the armband          |
| `POST /api/teams/{id}/join`                      | file a join request; `429` past the 5-a-day cap                  |
| `DELETE /api/teams/{id}/join?userId=N`           | leave the squad, or withdraw a pending request                   |
| `GET /api/teams/{id}/requests?captainId=N`       | the captain's queue (`status=all` includes decided ones)         |
| `POST /api/teams/{id}/requests`                  | `action: accept` or `decline`                                    |
| `POST /api/teams/{id}/invites`                   | invite a player; `429` past the cap, `403` for non-players       |
| `GET /api/teams/{id}/invites?captainId=N`        | the squad's sent invites + today's invite quota                  |
| `DELETE /api/teams/{id}/invites?captainId=&inviteId=` | take a still-pending invitation back                        |
| `GET /api/team-invites?userId=N`                 | this player's invitations + their daily request quota            |
| `POST /api/team-invites`                         | the player's `action: accept` (this is what adds them) or `decline` |
| `GET /api/teams/{id}?viewerId=N`                 | one squad in full for `/teams/{id}` — record, roster, the viewer's standing, and the captain's queue only when that viewer is the captain |
| `GET /api/players/{id}?viewerId=N`               | a player's dossier for `/players/{id}` — public profile, reliability, activity, and their request/invite history with teams *this viewer* captains |
| `GET /api/teams/{id}/members`                    | public roster — member emails are included only for `?viewerId=` the captain |
| `DELETE /api/teams/{id}/members?captainId=&userId=` | captain removes a member                                        |
| `POST /api/teams/{id}/members`                   | `405 consent_required` — direct adds are gone; use an invite     |
| `GET /api/users?q=&role=player`                  | people search behind the invite box, players only                |

- `src/lib/teams.ts` — code helpers (`normalizeTeamCode`, `suggestTeamCode`, role labels)
- `src/lib/team-store.ts` — search, code uniqueness, rosters, requests, invites, both daily quotas,
  `transferCaptaincy()`
- `src/components/TeamManager.tsx` — the captain's panel
- `src/app/teams/page.tsx` — search bar, honest buttons, create form
- `src/app/teams/[id]/page.tsx` — the squad in full: description, record, roster, and the one button
  that is true for you
- `src/app/players/[id]/page.tsx` — the player's dossier a captain reads before answering

Demo data: `aarav@futsal.np` captains **Chabahil Chargers** (`CHARGERS-4X7K`) with a join request
waiting on them, and has sent an invitation to `dipesh@futsal.np` that is still unanswered — log in
as either account and the respective queue has something to decide. No player is both invited and
requesting the same squad (the API refuses that pairing anyway), and no owner account sits on a demo
roster. Every seeded team has a code, a home turf picked from the seeded venues, and a description.
