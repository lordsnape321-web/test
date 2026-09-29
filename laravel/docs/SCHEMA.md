# Database design

Why this file exists: the schema grew one table at a time, one feature at a
time, and the result has no enforced relationships and several tables that mean
the same thing. This records what is actually there, what is wrong with it, and
what it is being turned into — so the reasoning survives past the person who
had to hold it all in their head.

## Where the schema stands

24 tables. Five unique constraints. **Zero foreign keys.** Every `booking_id`,
`user_id` and `team_id` in the project was a bare integer that nothing checked,
so a deleted venue left bookings pointing at nothing and a removed user left
ledger lines attributed to a ghost. The ER diagram was a drawing of intentions,
not a description of constraints the database would enforce.

## The money problem

Eight tables hold money, and "payment" has no single home:

| table | what it holds |
|---|---|
| `bookings` | `paid_amount`, `payment_status` — a cached total |
| `booking_team_payments` | a squad member's share, plus gateway state |
| `booking_payment_requests` | a captain's ask, plus the same gateway state |
| `booking_payments` | the venue's ledger |
| `team_ledger_entries` | the captain's own collection |
| `tournament_payments` | a tournament entry fee |
| `tournament_teams` | `paid_amount`, `gateway_txn_id` |
| `open_matches` | `paid_amount` (added 2025-09-01-000024) |

Seven columns appear in two of these tables: `amount_due`, `paid_amount`,
`payment_method`, `gateway_txn_id`, `esewa_uuid`, `khalti_pidx`, `status`.

`booking_team_payments` and `booking_payment_requests` are near-identical — a
booking, a payer, an amount, a method, a status and a gateway reference, in two
tables. `tournament_payments` and `team_ledger_entries` differ by two columns.

### Why this produced a visible bug

"Paid" on the booking card, "balance due" in the ledger panel, for the same
booking. `bookings.paid_amount` is a denormalised cache with six independent
writers computing it from different rows:

- `EsewaController:481` — assignment
- `EsewaController:562` — increment
- `EsewaController:500` — sum of team shares
- `KhaltiController:371,431` — two more patterns
- `LedgerController:247` — sum of `booking_payments`
- `BookingController:577` — zero

The card read one value, the ledger read `booking_payments`, and nothing
reconciled them. A cache with six writers and no single source cannot stay
correct.

## Other normalisation problems

- **Two sources of truth for captain.** `teams.captain_id` and
  `team_members.role = 'captain'`. Code that picked the wrong one would let a
  squad member rewrite a captain's books. `TeamStore::isCaptain` is the agreed
  single answer, reading `captain_id`.
- **`open_matches` re-declares `bookings`.** `venue_id`, `court_id`, `date`,
  `start_time`, `end_time` and the price all exist in both, joined only by a
  nullable `booking_id`, with nothing keeping the copies equal.
- **Cached counters.** `teams.wins/draws/losses` duplicate what match results
  already say.
- **`teams.home_ground` and `teams.home_venue_id`** are the same fact twice.
- **`tournament_matches.home_team_id`/`away_team_id` were `integer`** while
  every other id is `unsignedBigInteger`, so they could never take a foreign key
  as they stood. Corrected in `2025_09_01_000026`.

## What has been done

**Stage 1 — integrity and speed.** Landed and safe to run.

- `2025_09_01_000026_align_referential_column_types` — the two `integer`
  bracket columns become `unsignedBigInteger` nullable, and their `0`
  placeholders become `NULL`.
- `2025_09_01_000027_add_foreign_keys` — 56 constraints across every table.
  Orphan rows are purged in the same migration, immediately before the
  constraints are added, because a foreign key cannot be created over a
  dangling reference and a half-migrated database is worse than a slow one.
  Delete behaviour is per relationship, not blanket: `restrict` for money and
  identity, `set null` for "not linked yet", `cascade` for derived rows like
  notifications that mean nothing without their user.
- `2025_09_01_000028_add_query_indexes` — 12 composite indexes built from the
  real query shapes in the controllers, so reads stop sorting. Notably
  `users.phone`, which had no index at all despite being checked for uniqueness
  on every signup and every profile save.

**Stage 2 — the money domain.** Not yet implemented. The target:

One `payments` table for every movement of money, whatever its origin:

```
payments(id, venue_id, booking_id, tournament_id, team_id, payer_id,
         amount, method, reference, source, note, recorded_by,
         voided_at, voided_by, created_at, updated_at)
```

`source` in `owner | captain | gateway | tournament | advance` says who is
accounting for it; it does not create a second table. Shares reduce to what
they genuinely are — an obligation, not a payment — and what has been paid is
derived by summing `payments`:

```
booking_shares(id, booking_id, user_id, amount_due)
```

That removes all seven duplicated columns, and `bookings.paid_amount` and
`bookings.payment_status` are dropped rather than maintained, because they are
the cache that produced the bug. Every screen that showed "paid" then reads the
same rows and cannot disagree.

`booking_team_payments` and `booking_payment_requests` collapse into
`booking_shares` plus `payments`; `team_ledger_entries` and
`booking_payments` collapse into `payments` distinguished by `source`.

This is a destructive change with a data migration and it touches every gateway
path, so it runs only after Stage 1 has been applied and verified on a real
database.

## Rules for this schema going forward

- A new money movement is a row in `payments`, never a new table.
- An id column is `unsignedBigInteger`, and it carries a foreign key.
- A cached total is only allowed if one function writes it, and the writers
  are listed next to it.
- `TeamStore::isCaptain` is the only definition of "captain".
