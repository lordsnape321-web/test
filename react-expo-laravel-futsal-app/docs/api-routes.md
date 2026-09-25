# API surface

**Generated file — do not edit.** Run `node scripts/api-routes.mjs --write` instead.

Every HTTP endpoint this app exposes: **45 route files, 79 endpoints**.

This is the contract a Laravel backend has to reimplement. It is generated
from `src/app/api/**/route.ts` by `scripts/api-routes.mjs`, and
`tests/portability.mjs` fails if this file drifts from the routes on disk.

Behaviour — status codes, validation rules, the money ledger's locking — is
specified by the suites in `tests/api/`, which assert over plain HTTP and so
can be pointed at a Laravel host with `BASE_URL`.

| Method | Path | Source |
| --- | --- | --- |
| `POST` | `/auth/change-password` | `src/app/api/auth/change-password/route.ts` |
| `POST` | `/auth/login` | `src/app/api/auth/login/route.ts` |
| `POST` | `/auth/reset` | `src/app/api/auth/reset/route.ts` |
| `POST` | `/auth/signup` | `src/app/api/auth/signup/route.ts` |
| `GET` | `/availability` | `src/app/api/availability/route.ts` |
| `GET` | `/bookings` | `src/app/api/bookings/route.ts` |
| `POST` | `/bookings` | `src/app/api/bookings/route.ts` |
| `PATCH` | `/bookings/{id}` | `src/app/api/bookings/[id]/route.ts` |
| `DELETE` | `/bookings/{id}` | `src/app/api/bookings/[id]/route.ts` |
| `GET` | `/bookings/{id}/ledger` | `src/app/api/bookings/[id]/ledger/route.ts` |
| `POST` | `/bookings/{id}/ledger` | `src/app/api/bookings/[id]/ledger/route.ts` |
| `GET` | `/bookings/{id}/team-payments` | `src/app/api/bookings/[id]/team-payments/route.ts` |
| `POST` | `/bookings/{id}/team-payments` | `src/app/api/bookings/[id]/team-payments/route.ts` |
| `POST` | `/courts` | `src/app/api/courts/route.ts` |
| `PATCH` | `/courts/{id}` | `src/app/api/courts/[id]/route.ts` |
| `DELETE` | `/courts/{id}` | `src/app/api/courts/[id]/route.ts` |
| `GET` | `/health` | `src/app/api/health/route.ts` |
| `GET` | `/matches` | `src/app/api/matches/route.ts` |
| `POST` | `/matches` | `src/app/api/matches/route.ts` |
| `POST` | `/matches/{id}/join` | `src/app/api/matches/[id]/join/route.ts` |
| `DELETE` | `/matches/{id}/join` | `src/app/api/matches/[id]/join/route.ts` |
| `GET` | `/notifications` | `src/app/api/notifications/route.ts` |
| `POST` | `/notifications` | `src/app/api/notifications/route.ts` |
| `PATCH` | `/notifications/{id}` | `src/app/api/notifications/[id]/route.ts` |
| `DELETE` | `/notifications/{id}` | `src/app/api/notifications/[id]/route.ts` |
| `POST` | `/notifications/read-all` | `src/app/api/notifications/read-all/route.ts` |
| `POST` | `/payments/esewa/initiate` | `src/app/api/payments/esewa/initiate/route.ts` |
| `POST` | `/payments/esewa/verify` | `src/app/api/payments/esewa/verify/route.ts` |
| `POST` | `/payments/khalti/initiate` | `src/app/api/payments/khalti/initiate/route.ts` |
| `POST` | `/payments/khalti/verify` | `src/app/api/payments/khalti/verify/route.ts` |
| `GET` | `/players/{id}` | `src/app/api/players/[id]/route.ts` |
| `GET` | `/promos` | `src/app/api/promos/route.ts` |
| `POST` | `/promos` | `src/app/api/promos/route.ts` |
| `GET` | `/promos/{id}` | `src/app/api/promos/[id]/route.ts` |
| `PATCH` | `/promos/{id}` | `src/app/api/promos/[id]/route.ts` |
| `DELETE` | `/promos/{id}` | `src/app/api/promos/[id]/route.ts` |
| `GET` | `/reviews` | `src/app/api/reviews/route.ts` |
| `POST` | `/reviews` | `src/app/api/reviews/route.ts` |
| `DELETE` | `/reviews` | `src/app/api/reviews/route.ts` |
| `GET` | `/seed` | `src/app/api/seed/route.ts` |
| `POST` | `/seed` | `src/app/api/seed/route.ts` |
| `GET` | `/stats` | `src/app/api/stats/route.ts` |
| `GET` | `/team-invites` | `src/app/api/team-invites/route.ts` |
| `POST` | `/team-invites` | `src/app/api/team-invites/route.ts` |
| `GET` | `/teams` | `src/app/api/teams/route.ts` |
| `POST` | `/teams` | `src/app/api/teams/route.ts` |
| `GET` | `/teams/{id}` | `src/app/api/teams/[id]/route.ts` |
| `PATCH` | `/teams/{id}` | `src/app/api/teams/[id]/route.ts` |
| `GET` | `/teams/{id}/invites` | `src/app/api/teams/[id]/invites/route.ts` |
| `POST` | `/teams/{id}/invites` | `src/app/api/teams/[id]/invites/route.ts` |
| `DELETE` | `/teams/{id}/invites` | `src/app/api/teams/[id]/invites/route.ts` |
| `POST` | `/teams/{id}/join` | `src/app/api/teams/[id]/join/route.ts` |
| `DELETE` | `/teams/{id}/join` | `src/app/api/teams/[id]/join/route.ts` |
| `GET` | `/teams/{id}/members` | `src/app/api/teams/[id]/members/route.ts` |
| `POST` | `/teams/{id}/members` | `src/app/api/teams/[id]/members/route.ts` |
| `DELETE` | `/teams/{id}/members` | `src/app/api/teams/[id]/members/route.ts` |
| `GET` | `/teams/{id}/requests` | `src/app/api/teams/[id]/requests/route.ts` |
| `POST` | `/teams/{id}/requests` | `src/app/api/teams/[id]/requests/route.ts` |
| `GET` | `/tournaments` | `src/app/api/tournaments/route.ts` |
| `POST` | `/tournaments` | `src/app/api/tournaments/route.ts` |
| `GET` | `/tournaments/{id}` | `src/app/api/tournaments/[id]/route.ts` |
| `PATCH` | `/tournaments/{id}` | `src/app/api/tournaments/[id]/route.ts` |
| `GET` | `/tournaments/{id}/matches` | `src/app/api/tournaments/[id]/matches/route.ts` |
| `POST` | `/tournaments/{id}/matches` | `src/app/api/tournaments/[id]/matches/route.ts` |
| `GET` | `/tournaments/{id}/media` | `src/app/api/tournaments/[id]/media/route.ts` |
| `POST` | `/tournaments/{id}/media` | `src/app/api/tournaments/[id]/media/route.ts` |
| `GET` | `/tournaments/{id}/payments` | `src/app/api/tournaments/[id]/payments/route.ts` |
| `POST` | `/tournaments/{id}/payments` | `src/app/api/tournaments/[id]/payments/route.ts` |
| `GET` | `/tournaments/{id}/teams` | `src/app/api/tournaments/[id]/teams/route.ts` |
| `POST` | `/tournaments/{id}/teams` | `src/app/api/tournaments/[id]/teams/route.ts` |
| `GET` | `/users` | `src/app/api/users/route.ts` |
| `GET` | `/users/{id}` | `src/app/api/users/[id]/route.ts` |
| `PATCH` | `/users/{id}` | `src/app/api/users/[id]/route.ts` |
| `GET` | `/venues` | `src/app/api/venues/route.ts` |
| `POST` | `/venues` | `src/app/api/venues/route.ts` |
| `GET` | `/venues/{id}` | `src/app/api/venues/[id]/route.ts` |
| `PATCH` | `/venues/{id}` | `src/app/api/venues/[id]/route.ts` |
| `DELETE` | `/venues/{id}` | `src/app/api/venues/[id]/route.ts` |
| `GET` | `/vouchers` | `src/app/api/vouchers/route.ts` |
