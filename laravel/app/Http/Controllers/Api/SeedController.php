<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\Court;
use App\Models\MatchJoin;
use App\Models\OpenMatch;
use App\Models\Promo;
use App\Models\Review;
use App\Models\Team;
use App\Models\TeamInvite;
use App\Models\TeamMember;
use App\Models\TeamRequest;
use App\Models\Tournament;
use App\Models\TournamentMatch;
use App\Models\TournamentMedia;
use App\Models\TournamentPayment;
use App\Models\TournamentTeam;
use App\Models\User;
use App\Models\Venue;
use App\Support\Futsal;
use App\Support\LegacyPassword;
use App\Support\Teams;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * POST|GET /api/seed — the demo dataset 🌱
 *
 * Idempotent by design: run it against a database that already has venues and
 * it backfills whatever a newer build added (password hashes, venue owners,
 * reviews, promo codes, squads) instead of refusing, and returns "Already
 * seeded" with a report of what it topped up. Run it against an empty one and it
 * builds the whole world: nine players, six grounds, fourteen pitches, bookings,
 * open games, five squads with their rosters and pending queues in both
 * directions, reviews, promo codes and two leagues — one open and owner-hosted,
 * one private and player-hosted — so every screen in the app has something real
 * to show.
 *
 * The heavy lifting lives in `database/seeders/DemoDataSeeder.php` too, so
 * `php artisan db:seed` gets the same data without going through HTTP.
 */
class SeedController extends ApiController
{
    private const DEFAULT_PASSWORD = 'futsal123';

    /** Demo accounts, in the order they are inserted. */
    private const DEMO_USER_EMAILS = [
        'aarav@futsal.np', 'bikash@futsal.np', 'chirag@futsal.np', 'dipesh@futsal.np',
        'elish@futsal.np', 'farhan@futsal.np', 'ganesh@futsal.np', 'himal@futsal.np',
        'priya@futsal.np',
    ];

    public function store(): JsonResponse
    {
        try {
            return DB::transaction(fn () => $this->seed(), 3);
        } catch (\Throwable $e) {
            return $this->fail($e->getMessage(), 500);
        }
    }

    /** GET does exactly what POST does — the route was always hit from a browser bar. */
    public function index(): JsonResponse
    {
        return $this->store();
    }

    private function seed(): JsonResponse
    {
        $existingVenues = Venue::all();

        /* ══════════════════════════ already seeded ══════════════════════════ */
        if ($existingVenues->isNotEmpty()) {
            $allUsers = User::all();

            // Backfill auth + ownership for databases seeded before login existed.
            $defaultHash = LegacyPassword::hash(self::DEFAULT_PASSWORD);

            foreach ($allUsers as $u) {
                if (empty($u->password_hash)) {
                    $u->forceFill(['password_hash' => $defaultHash])->save();
                }
            }

            $owner = $allUsers->firstWhere('role', 'owner') ?? $allUsers->first();

            if ($owner) {
                foreach ($existingVenues as $v) {
                    if (empty($v->owner_id)) {
                        $v->forceFill(['owner_id' => $owner->id])->save();
                    }
                }
            }

            $report = [
                'ok' => true,
                'message' => 'Already seeded',
                'count' => $existingVenues->count(),
                'seededReviews' => 0,
                'seededPromos' => 0,
                'seededTeams' => 0,
                'seededTeamCodes' => 0,
                'seededTeamDescriptions' => 0,
                'seededTeamInvites' => 0,
                'seededTeamRequests' => 0,
            ];

            // Backfill reviews for databases seeded before reviews existed.
            if (Review::count() === 0) {
                $byName = $existingVenues->mapWithKeys(fn ($v) => [$v->name => $v->id]);
                $validUserIds = $allUsers->pluck('id')->map(fn ($v) => (int) $v)->all();

                foreach ($this->demoReviewsFor($byName, 1) as $r) {
                    if (! in_array((int) $r['userId'], $validUserIds, true)) {
                        continue;
                    }

                    Review::create([
                        'venue_id' => $r['venueId'],
                        'user_id' => $r['userId'],
                        'booking_id' => null,
                        'rating' => $r['rating'],
                        'message' => $r['message'],
                    ]);

                    $report['seededReviews']++;
                }
            }

            // Backfill promo codes for databases seeded before promos existed.
            if (Promo::count() === 0) {
                $byName = $existingVenues->mapWithKeys(fn ($v) => [$v->name => $v->id]);

                foreach ($this->demoPromos(fn ($name) => $byName[$name] ?? null) as $values) {
                    Promo::create($values);
                    $report['seededPromos']++;
                }
            }

            /*
             * Teams 🛡️ — rebuild the demo squads if the table is empty. Without
             * this, a truncated `teams` table leaves the app with no squads and
             * no way to get them back, because this branch reports "Already
             * seeded" as soon as venues exist.
             */
            if (Team::count() === 0) {
                $venueByName = $existingVenues->mapWithKeys(fn ($v) => [$v->name => $v->id]);
                $userByEmail = $allUsers->mapWithKeys(fn ($u) => [$u->email => $u->id]);
                $userAt = fn (int $i) => $userByEmail[self::DEMO_USER_EMAILS[$i]] ?? null;

                $teams = [];

                foreach ($this->demoTeams() as $t) {
                    $captain = $userAt((int) $t['captain']);

                    if (! $captain) {
                        continue;
                    }

                    $row = Team::create([
                        'name' => $t['name'],
                        'motto' => $t['motto'],
                        'description' => $t['desc'],
                        'team_code' => $t['code'],
                        'captain_id' => $captain,
                        'max_players' => 12,
                        'level' => $t['level'],
                        'logo_color' => $t['color'],
                        'wins' => $t['w'],
                        'losses' => $t['l'],
                        'draws' => $t['d'],
                        'home_venue_id' => $venueByName[$t['home']] ?? null,
                        'home_ground' => $t['home'],
                        'looking_for_players' => true,
                    ]);

                    $teams[] = $row;
                    $report['seededTeams']++;
                    $report['seededTeamCodes']++;
                    $report['seededTeamDescriptions']++;
                }

                foreach ($this->demoTeamMemberships() as [$ti, $ui, $role]) {
                    $team = $teams[$ti] ?? null;
                    $user = $userAt((int) $ui);

                    if (! $team || ! $user) {
                        continue;
                    }

                    TeamMember::create([
                        'team_id' => $team->id,
                        'user_id' => $user,
                        'role' => $role,
                    ]);
                }

                // Pending invitations — so a *player* logging in has something
                // to answer. Each invitee is deliberately not on that roster.
                foreach ($this->demoTeamInvites() as [$ti, $ui, $message]) {
                    $team = $teams[$ti] ?? null;
                    $player = $userAt((int) $ui);

                    if (! $team || ! $player) {
                        continue;
                    }

                    TeamInvite::create([
                        'team_id' => $team->id,
                        'user_id' => $player,
                        'invited_by' => $team->captain_id,
                        'message' => $message,
                        'status' => Teams::REQUEST_PENDING,
                    ]);

                    $report['seededTeamInvites']++;
                }

                // Pending join requests — so a captain logging in has something
                // to decide. Every requester is not already a member.
                foreach ($this->demoTeamJoinRequests() as [$ti, $ui, $message]) {
                    $team = $teams[$ti] ?? null;
                    $player = $userAt((int) $ui);

                    if (! $team || ! $player) {
                        continue;
                    }

                    TeamRequest::create([
                        'team_id' => $team->id,
                        'user_id' => $player,
                        'message' => $message,
                        'status' => Teams::REQUEST_PENDING,
                    ]);

                    $report['seededTeamRequests']++;
                }
            }

            // Leagues 🏆 — seeded last, because they reference users, venues,
            // courts and squads that may all have been rebuilt just above.
            $allVenues = Venue::all(['id', 'name'])->toArray();
            $allTeams = Team::all(['id', 'team_code'])->toArray();
            $allCourts = Court::all(['id', 'venue_id'])->toArray();

            $report['leagues'] = $this->seedLeagues([
                'userId' => function (string $email) use ($allUsers) {
                    $u = $allUsers->firstWhere('email', $email);

                    return $u ? (int) $u->id : null;
                },
                'venueId' => function (string $name) use ($allVenues) {
                    foreach ($allVenues as $v) {
                        if ($v['name'] === $name) {
                            return (int) $v['id'];
                        }
                    }

                    return null;
                },
                'courtId' => function (string $venueName) use ($allVenues, $allCourts) {
                    $venueId = null;

                    foreach ($allVenues as $v) {
                        if ($v['name'] === $venueName) {
                            $venueId = (int) $v['id'];
                            break;
                        }
                    }

                    foreach ($allCourts as $c) {
                        if ((int) $c['venue_id'] === (int) $venueId) {
                            return (int) $c['id'];
                        }
                    }

                    return null;
                },
                'teamId' => function (string $code) use ($allTeams) {
                    foreach ($allTeams as $t) {
                        if ($t['team_code'] === $code) {
                            return (int) $t['id'];
                        }
                    }

                    return null;
                },
            ]);

            return $this->ok($report);
        }

        /* ═══════════════════════════ fresh seed ═════════════════════════════ */
        $pw = LegacyPassword::hash(self::DEFAULT_PASSWORD);

        $users = $this->seedUsers($pw);

        $insertedUsers = [];

        foreach ($users as $u) {
            $insertedUsers[] = User::create($u);
        }

        $ganesh = $insertedUsers[6];
        $priya = $insertedUsers[8];

        $insertedVenues = [];

        foreach ($this->seedVenues($ganesh->id, $priya->id) as $v) {
            $insertedVenues[] = Venue::create($v);
        }

        $insertedCourts = [];

        foreach ($this->courtDefs() as $i => $cd) {
            $insertedCourts[] = Court::create([
                'venue_id' => $insertedVenues[$cd['venueIdx']]->id,
                'name' => $cd['name'],
                'format' => $cd['format'],
                'surface' => $cd['surface'],
                'price_per_hour' => $cd['price'],
                'price_morning' => $cd['morning'],
                'image_url' => Futsal::VENUE_IMAGES[$i % count(Futsal::VENUE_IMAGES)],
                'features' => 'Floodlights,Nets Provided,Match Balls,Drinking Water',
            ]);
        }

        // Promo codes — owner-created discounts with expiry dates.
        $venueNames = ['Dhanyentari Futsal Arena', 'KickOff Sports Hub', 'GoalZone Futsal Park',
            'Lakeside Strikers Court', 'Rhino Sports Complex', 'NightOwl Futsal'];

        foreach ($this->demoPromos(function (string $name) use ($venueNames, $insertedVenues) {
            $idx = array_search($name, $venueNames, true);

            return $idx === false ? null : (int) $insertedVenues[$idx]->id;
        }) as $values) {
            Promo::create($values);
        }

        // Bookings — a mix of paid and pending, individual and squad, one in the
        // past so "past bookings" has something to show.
        $insertedBookings = [];

        foreach ($this->bookingSeeds() as $b) {
            $court = $insertedCourts[$b['court']];
            $hourNum = (int) explode(':', $b['start'])[0];
            $rate = $hourNum < 12 ? (int) $court->price_morning : (int) $court->price_per_hour;
            $dur = (int) explode(':', $b['end'])[0] - $hourNum;
            $isPublic = ($b['pub'] ?? false) === true;
            $need = $b['need'] ?? 10;
            $crew = max(1, (int) ceil($need / 2));
            $open = $need - $crew;
            $booker = $insertedUsers[$b['user']];

            $booking = Booking::create([
                'court_id' => $court->id,
                'user_id' => $booker->id,
                'date' => $this->d($b['dateOff']),
                'start_time' => $b['start'],
                'end_time' => $b['end'],
                'duration_hours' => $dur,
                'total_price' => $rate * $dur,
                'status' => $b['dateOff'] < 0 ? 'completed' : 'confirmed',
                'payment_status' => $b['pay'],
                'payment_method' => $b['method'],
                'booker_name' => $booker->name,
                'booker_phone' => $booker->phone,
                'visibility' => $isPublic ? 'public' : 'private',
                'players_needed' => $isPublic ? $need : 0,
                'our_crew' => $isPublic ? $crew : 1,
                'open_spots' => $isPublic ? $open : 0,
            ]);

            $insertedBookings[] = $booking;

            // A public booking gets a linked open-match listing.
            if ($isPublic) {
                $perPlayer = max(50, (int) round($booking->total_price / $need));

                $match = OpenMatch::create([
                    'title' => $b['title'] ?? "Open game at {$court->name} ⚡",
                    'venue_id' => $court->venue_id,
                    'court_id' => $court->id,
                    'organizer_id' => $booker->id,
                    'booking_id' => $booking->id,
                    'date' => $this->d($b['dateOff']),
                    'start_time' => $b['start'],
                    'end_time' => $b['end'],
                    'price_per_player' => $perPlayer,
                    'max_players' => $need,
                    'crew_size' => $crew,
                    'level' => 'All Levels',
                    'status' => 'open',
                    'description' => "👥 {$crew} from our crew • 🙋 {$open} open for you! Court already booked — just join and split the cost! 🤝",
                ]);

                MatchJoin::create(['match_id' => $match->id, 'user_id' => $booker->id]);

                foreach (array_slice(array_values(array_filter([0, 1, 2, 3, 4, 5], fn ($i) => $i !== $b['user'])), 0, 3) as $oi) {
                    MatchJoin::create(['match_id' => $match->id, 'user_id' => $insertedUsers[$oi]->id]);
                }
            }
        }

        // Squads 🛡️ — each with a unique searchable code and a home turf that
        // names a venue actually on the platform.
        $insertedTeams = [];

        foreach ($this->demoTeams() as $t) {
            $insertedTeams[] = Team::create([
                'name' => $t['name'],
                'motto' => $t['motto'],
                'description' => $t['desc'],
                'team_code' => $t['code'],
                'captain_id' => $insertedUsers[$t['captain']]->id,
                'max_players' => 12,
                'level' => $t['level'],
                'logo_color' => $t['color'],
                'wins' => $t['w'],
                'losses' => $t['l'],
                'draws' => $t['d'],
                'home_venue_id' => collect($insertedVenues)->firstWhere('name', $t['home'])?->id,
                'home_ground' => $t['home'],
                'looking_for_players' => true,
            ]);
        }

        foreach ($this->demoTeamMemberships() as [$ti, $ui, $role]) {
            TeamMember::create([
                'team_id' => $insertedTeams[$ti]->id,
                'user_id' => $insertedUsers[$ui]->id,
                'role' => $role,
            ]);
        }

        // Pending join requests 👑 — so a captain logging in has something to decide.
        foreach ($this->demoTeamJoinRequests() as [$ti, $ui, $message]) {
            TeamRequest::create([
                'team_id' => $insertedTeams[$ti]->id,
                'user_id' => $insertedUsers[$ui]->id,
                'message' => $message,
                'status' => Teams::REQUEST_PENDING,
            ]);
        }

        // …and pending invitations 📨 — the same queue from the player's side.
        foreach ($this->demoTeamInvites() as [$ti, $ui, $message]) {
            TeamInvite::create([
                'team_id' => $insertedTeams[$ti]->id,
                'user_id' => $insertedUsers[$ui]->id,
                'invited_by' => $insertedTeams[$ti]->captain_id,
                'message' => $message,
                'status' => Teams::REQUEST_PENDING,
            ]);
        }

        // Attach squads to the bookings that asked for one. Teams only exist at
        // this point, hence the follow-up update.
        $bookingSeeds = $this->bookingSeeds();

        foreach ($bookingSeeds as $bi => $b) {
            $ti = $b['team'] ?? null;

            if ($ti === null || ! isset($insertedBookings[$bi], $insertedTeams[$ti])) {
                continue;
            }

            $insertedBookings[$bi]->forceFill([
                'team_id' => $insertedTeams[$ti]->id,
                'team_name' => $insertedTeams[$ti]->name,
            ])->save();
        }

        // Open matches — games without a booking behind them.
        $insertedMatches = [];

        foreach ($this->matchSeeds() as $m) {
            $insertedMatches[] = OpenMatch::create([
                'title' => $m['title'],
                'venue_id' => $insertedVenues[$m['venue']]->id,
                'court_id' => $insertedCourts[$m['court']]->id,
                'organizer_id' => $insertedUsers[$m['org']]->id,
                'date' => $this->d($m['off']),
                'start_time' => $m['start'],
                'end_time' => $m['end'],
                'price_per_player' => $m['price'],
                'max_players' => $m['max'],
                'level' => $m['level'],
                'status' => 'open',
                'description' => $m['desc'],
            ]);
        }

        foreach ([[0, 0], [0, 1], [0, 3], [0, 5], [0, 4], [1, 3], [1, 7], [1, 2],
            [2, 5], [2, 0], [2, 1], [2, 3], [2, 4], [2, 6], [3, 1], [3, 2], [3, 7],
            [4, 4], [4, 0]] as [$mi, $ui]) {
            MatchJoin::create([
                'match_id' => $insertedMatches[$mi]->id,
                'user_id' => $insertedUsers[$ui]->id,
            ]);
        }

        // Sample reviews from happy players, then refresh the venue averages.
        $reviewSeeds = [
            ['venue' => 0, 'user' => 1, 'rating' => 5, 'message' => 'Best turf in town! The lights at night are amazing and the staff even helped us split teams. Felt like home 🏟️'],
            ['venue' => 0, 'user' => 4, 'rating' => 5, 'message' => 'Booked for my birthday game — they surprised us with extra balls and music. 10/10 vibes! 🎉'],
            ['venue' => 0, 'user' => 3, 'rating' => 4, 'message' => 'Great courts, gets busy on weekends so book early. Showers are clean! ⚽'],
            ['venue' => 1, 'user' => 0, 'rating' => 5, 'message' => 'Rooftop views while playing = unreal! Coffee after the game hits different here ☕'],
            ['venue' => 1, 'user' => 5, 'rating' => 4, 'message' => 'Cosy spot, friendly uncle at reception. Parking is a bit tight but worth it!'],
            ['venue' => 3, 'user' => 2, 'rating' => 5, 'message' => 'Played with the lake breeze — magical evening! Beginners were so welcome 🌱'],
        ];

        foreach ($reviewSeeds as $r) {
            Review::create([
                'venue_id' => $insertedVenues[$r['venue']]->id,
                'user_id' => $insertedUsers[$r['user']]->id,
                'booking_id' => null,
                'rating' => $r['rating'],
                'message' => $r['message'],
            ]);
        }

        foreach ($insertedVenues as $vi => $venue) {
            $mine = array_values(array_filter($reviewSeeds, fn ($r) => $r['venue'] === $vi));

            if ($mine === []) {
                continue;
            }

            $avg = array_sum(array_column($mine, 'rating')) / count($mine);

            $venue->forceFill([
                'rating' => round($avg * 10) / 10,
                'total_reviews' => 120 + count($mine) * 37,
            ])->save();
        }

        // Leagues 🏆 — the tournament layer, seeded last because it refers to
        // every squad and pitch above.
        $leagueReport = $this->seedLeagues([
            'userId' => function (string $email) use ($insertedUsers) {
                foreach ($insertedUsers as $u) {
                    if ($u->email === $email) {
                        return (int) $u->id;
                    }
                }

                return null;
            },
            'venueId' => function (string $name) use ($insertedVenues) {
                foreach ($insertedVenues as $v) {
                    if ($v->name === $name) {
                        return (int) $v->id;
                    }
                }

                return null;
            },
            'courtId' => function (string $venueName) use ($insertedVenues, $insertedCourts) {
                $venueId = null;

                foreach ($insertedVenues as $v) {
                    if ($v->name === $venueName) {
                        $venueId = (int) $v->id;
                        break;
                    }
                }

                foreach ($insertedCourts as $c) {
                    if ((int) $c->venue_id === (int) $venueId) {
                        return (int) $c->id;
                    }
                }

                return null;
            },
            'teamId' => function (string $code) use ($insertedTeams) {
                foreach ($insertedTeams as $t) {
                    if ($t->team_code === $code) {
                        return (int) $t->id;
                    }
                }

                return null;
            },
        ]);

        return $this->ok(['ok' => true, 'message' => 'Seeded successfully', 'leagues' => $leagueReport]);
    }

    /* ══════════════════════════════ the data ══════════════════════════════ */

    private function d(int $offset): string
    {
        return now()->addDays($offset)->toDateString();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function seedUsers(string $pw): array
    {
        return [
            ['name' => 'Aarav Sharma', 'email' => 'aarav@futsal.np', 'phone' => '9841000001', 'password_hash' => $pw, 'role' => 'player', 'avatar_color' => '#16a34a', 'avatar_url' => '', 'default_city' => 'Kathmandu', 'level' => 'Advanced', 'position' => 'Striker', 'matches_played' => 48],
            ['name' => 'Bikash Thapa', 'email' => 'bikash@futsal.np', 'phone' => '9841000002', 'password_hash' => $pw, 'role' => 'player', 'avatar_color' => '#2563eb', 'avatar_url' => '', 'default_city' => 'Lalitpur', 'level' => 'Intermediate', 'position' => 'Midfielder', 'matches_played' => 32],
            ['name' => 'Chirag Gurung', 'email' => 'chirag@futsal.np', 'phone' => '9841000003', 'password_hash' => $pw, 'role' => 'player', 'avatar_color' => '#dc2626', 'avatar_url' => '', 'default_city' => 'Pokhara', 'level' => 'Beginner', 'position' => 'Goalkeeper', 'matches_played' => 12],
            ['name' => 'Dipesh Karki', 'email' => 'dipesh@futsal.np', 'phone' => '9841000004', 'password_hash' => $pw, 'role' => 'player', 'avatar_color' => '#9333ea', 'avatar_url' => '', 'default_city' => 'Kathmandu', 'level' => 'Advanced', 'position' => 'Defender', 'matches_played' => 61],
            ['name' => 'Elish Shrestha', 'email' => 'elish@futsal.np', 'phone' => '9841000005', 'password_hash' => $pw, 'role' => 'player', 'avatar_color' => '#ea580c', 'avatar_url' => '', 'default_city' => 'Bhaktapur', 'level' => 'Intermediate', 'position' => 'Winger', 'matches_played' => 27],
            ['name' => 'Farhan Ali', 'email' => 'farhan@futsal.np', 'phone' => '9841000006', 'password_hash' => $pw, 'role' => 'player', 'avatar_color' => '#0891b2', 'avatar_url' => '', 'default_city' => 'Chitwan', 'level' => 'Advanced', 'position' => 'Pivot', 'matches_played' => 55],
            ['name' => 'Ganesh Rai', 'email' => 'ganesh@futsal.np', 'phone' => '9841000007', 'password_hash' => $pw, 'role' => 'owner', 'avatar_color' => '#4d7c0f', 'avatar_url' => '', 'default_city' => 'Kathmandu', 'level' => '—', 'position' => 'Owner', 'matches_played' => 20],
            ['name' => 'Himal Basnet', 'email' => 'himal@futsal.np', 'phone' => '9841000008', 'password_hash' => $pw, 'role' => 'player', 'avatar_color' => '#be123c', 'avatar_url' => '', 'default_city' => 'Kathmandu', 'level' => 'Beginner', 'position' => 'Defender', 'matches_played' => 8],
            ['name' => 'Priya Maharjan', 'email' => 'priya@futsal.np', 'phone' => '9841000009', 'password_hash' => $pw, 'role' => 'owner', 'avatar_color' => '#7c3aed', 'avatar_url' => '', 'default_city' => 'Pokhara', 'level' => '—', 'position' => 'Owner', 'matches_played' => 5],
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function seedVenues(int $ganeshId, int $priyaId): array
    {
        return [
            ['name' => 'Dhanyentari Futsal Arena', 'address' => 'Chabahil, Kathmandu', 'city' => 'Kathmandu', 'phone' => '01-4567890', 'description' => 'Premium FIFA-standard turf with floodlights, pro changing rooms and live scoreboard. Kathmandu’s most booked arena.', 'image_url' => Futsal::VENUE_IMAGES[0], 'rating' => 4.9, 'total_reviews' => 412, 'opening_hour' => 5, 'closing_hour' => 23, 'amenities' => 'Parking,Changing Room,Shower,WiFi,Cafeteria,First Aid,Live Scoreboard,Locker', 'is_featured' => true, 'accepted_payments' => 'eSewa,Khalti,Cash at Venue', 'deposit_percent' => 30, 'owner_id' => $ganeshId],
            ['name' => 'KickOff Sports Hub', 'address' => 'Jhamsikhel, Lalitpur', 'city' => 'Lalitpur', 'phone' => '01-5532123', 'description' => 'Two rooftop courts with city views, cafe and weekend leagues. Perfect for corporate games.', 'image_url' => Futsal::VENUE_IMAGES[1], 'rating' => 4.7, 'total_reviews' => 268, 'opening_hour' => 6, 'closing_hour' => 22, 'amenities' => 'Parking,Cafeteria,WiFi,Rooftop View,Music System,First Aid', 'is_featured' => true, 'accepted_payments' => 'eSewa,Cash at Venue', 'deposit_percent' => 25, 'owner_id' => $ganeshId],
            ['name' => 'GoalZone Futsal Park', 'address' => 'Suryabinayak, Bhaktapur', 'city' => 'Bhaktapur', 'phone' => '01-6614455', 'description' => 'Family-friendly futsal park with 3 courts, kids coaching academy and healthy juice bar.', 'image_url' => Futsal::VENUE_IMAGES[2], 'rating' => 4.6, 'total_reviews' => 189, 'opening_hour' => 6, 'closing_hour' => 21, 'amenities' => 'Parking,Academy,Kids Zone,Juice Bar,Changing Room,Shower', 'is_featured' => false, 'accepted_payments' => 'Cash at Venue', 'deposit_percent' => 0, 'owner_id' => $ganeshId],
            ['name' => 'Lakeside Strikers Court', 'address' => 'Lakeside, Pokhara', 'city' => 'Pokhara', 'phone' => '061-463322', 'description' => 'Scenic court near Phewa lake with mountain views. Tourist favourite with equipment rental.', 'image_url' => Futsal::VENUE_IMAGES[3], 'rating' => 4.8, 'total_reviews' => 324, 'opening_hour' => 6, 'closing_hour' => 22, 'amenities' => 'Parking,Equipment Rental,Cafeteria,Mountain View,Shower,WiFi', 'is_featured' => true, 'accepted_payments' => 'eSewa,Khalti', 'deposit_percent' => 40, 'owner_id' => $priyaId],
            ['name' => 'Rhino Sports Complex', 'address' => 'Bharatpur, Chitwan', 'city' => 'Chitwan', 'phone' => '056-522110', 'description' => 'Biggest complex in Chitwan with 7v7 and 5v5 courts, gym and physio support.', 'image_url' => Futsal::VENUE_IMAGES[4], 'rating' => 4.5, 'total_reviews' => 156, 'opening_hour' => 5, 'closing_hour' => 22, 'amenities' => 'Parking,Gym,Physio,Cafeteria,Changing Room,First Aid', 'is_featured' => false, 'accepted_payments' => 'eSewa,Khalti,Cash at Venue', 'deposit_percent' => 30, 'owner_id' => $priyaId],
            ['name' => 'NightOwl Futsal', 'address' => 'Thamel, Kathmandu', 'city' => 'Kathmandu', 'phone' => '01-4445566', 'description' => 'Open till late with neon night vibes, DJ Fridays and midnight tournaments.', 'image_url' => Futsal::VENUE_IMAGES[5], 'rating' => 4.4, 'total_reviews' => 231, 'opening_hour' => 8, 'closing_hour' => 23, 'amenities' => 'Parking,Music System,Night Lights,Cafeteria,WiFi,Locker', 'is_featured' => false, 'accepted_payments' => 'Khalti,Cash at Venue', 'deposit_percent' => 20, 'owner_id' => $priyaId],
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function courtDefs(): array
    {
        return [
            ['venueIdx' => 0, 'name' => 'Arena A — Pro Turf', 'format' => '5v5', 'surface' => 'FIFA Artificial Turf', 'price' => 2000, 'morning' => 1500],
            ['venueIdx' => 0, 'name' => 'Arena B — Speed Court', 'format' => '5v5', 'surface' => 'Futsal Mat', 'price' => 1800, 'morning' => 1300],
            ['venueIdx' => 0, 'name' => 'Arena C — Big Game', 'format' => '7v7', 'surface' => 'Artificial Turf', 'price' => 2800, 'morning' => 2200],
            ['venueIdx' => 1, 'name' => 'Rooftop 1', 'format' => '5v5', 'surface' => 'Artificial Turf', 'price' => 1700, 'morning' => 1300],
            ['venueIdx' => 1, 'name' => 'Rooftop 2', 'format' => '6v6', 'surface' => 'Artificial Turf', 'price' => 1900, 'morning' => 1400],
            ['venueIdx' => 2, 'name' => 'Green Court', 'format' => '5v5', 'surface' => 'Grass Hybrid', 'price' => 1400, 'morning' => 1000],
            ['venueIdx' => 2, 'name' => 'Blue Court', 'format' => '5v5', 'surface' => 'Futsal Mat', 'price' => 1500, 'morning' => 1100],
            ['venueIdx' => 2, 'name' => 'Academy Court', 'format' => '7v7', 'surface' => 'Artificial Turf', 'price' => 2200, 'morning' => 1700],
            ['venueIdx' => 3, 'name' => 'Lake View Court', 'format' => '5v5', 'surface' => 'Artificial Turf', 'price' => 1600, 'morning' => 1200],
            ['venueIdx' => 3, 'name' => 'Mountain Court', 'format' => '6v6', 'surface' => 'FIFA Artificial Turf', 'price' => 1800, 'morning' => 1300],
            ['venueIdx' => 4, 'name' => 'Rhino Grand', 'format' => '7v7', 'surface' => 'Grass Hybrid', 'price' => 2500, 'morning' => 1900],
            ['venueIdx' => 4, 'name' => 'Rhino Mini', 'format' => '5v5', 'surface' => 'Artificial Turf', 'price' => 1500, 'morning' => 1100],
            ['venueIdx' => 5, 'name' => 'Neon Court 1', 'format' => '5v5', 'surface' => 'Futsal Mat', 'price' => 1900, 'morning' => 1400],
            ['venueIdx' => 5, 'name' => 'Neon Court 2', 'format' => '5v5', 'surface' => 'Futsal Mat', 'price' => 1900, 'morning' => 1400],
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function bookingSeeds(): array
    {
        return [
            ['court' => 0, 'user' => 0, 'dateOff' => 0, 'start' => '17:00', 'end' => '18:00', 'pay' => 'paid', 'method' => 'eSewa', 'pub' => true, 'need' => 10, 'title' => 'Evening Rush — Arena A ⚡', 'team' => 0],
            ['court' => 0, 'user' => 1, 'dateOff' => 0, 'start' => '18:00', 'end' => '19:00', 'pay' => 'pending', 'method' => 'Khalti', 'team' => 0],
            ['court' => 0, 'user' => 2, 'dateOff' => 1, 'start' => '07:00', 'end' => '08:00', 'pay' => 'paid', 'method' => 'Cash at Venue', 'team' => 3],
            ['court' => 1, 'user' => 3, 'dateOff' => 0, 'start' => '19:00', 'end' => '20:00', 'pay' => 'paid', 'method' => 'Khalti', 'team' => 1],
            ['court' => 3, 'user' => 4, 'dateOff' => 1, 'start' => '18:00', 'end' => '20:00', 'pay' => 'pending', 'method' => 'eSewa', 'pub' => true, 'need' => 12, 'title' => 'Rooftop Rumble 🌇'],
            ['court' => 8, 'user' => 5, 'dateOff' => 2, 'start' => '16:00', 'end' => '17:00', 'pay' => 'paid', 'method' => 'Khalti'],
            ['court' => 5, 'user' => 0, 'dateOff' => -1, 'start' => '17:00', 'end' => '18:00', 'pay' => 'paid', 'method' => 'Cash', 'team' => 3],
            ['court' => 10, 'user' => 1, 'dateOff' => 3, 'start' => '08:00', 'end' => '09:00', 'pay' => 'pending', 'method' => 'eSewa'],
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function matchSeeds(): array
    {
        return [
            ['title' => 'Friday Night Showdown ⚡', 'venue' => 0, 'court' => 0, 'org' => 0, 'off' => 1, 'start' => '19:00', 'end' => '20:00', 'price' => 200, 'max' => 10, 'level' => 'Intermediate', 'desc' => 'Competitive but friendly. Bibs provided. Come 15 min early for warmup!'],
            ['title' => 'Morning Kickabout ☀️', 'venue' => 1, 'court' => 3, 'org' => 3, 'off' => 0, 'start' => '07:00', 'end' => '08:00', 'price' => 150, 'max' => 12, 'level' => 'All Levels', 'desc' => 'Chill morning game, all levels welcome. Great for beginners!'],
            ['title' => 'Weekend Warriors Cup 🏆', 'venue' => 3, 'court' => 8, 'org' => 5, 'off' => 3, 'start' => '16:00', 'end' => '18:00', 'price' => 300, 'max' => 14, 'level' => 'Advanced', 'desc' => 'Mini tournament style — 4 teams, knockout. Winners get free momos!'],
            ['title' => 'Beginners Only — Learn & Play 🌱', 'venue' => 2, 'court' => 5, 'org' => 1, 'off' => 2, 'start' => '10:00', 'end' => '11:00', 'price' => 120, 'max' => 10, 'level' => 'Beginner', 'desc' => 'New to futsal? Join us! Coach on-site for first 20 minutes.'],
            ['title' => 'Midnight Madness 🌙', 'venue' => 5, 'court' => 12, 'org' => 4, 'off' => 1, 'start' => '21:00', 'end' => '22:00', 'price' => 250, 'max' => 10, 'level' => 'Intermediate', 'desc' => 'Neon lights, music, late night football. Unmatched vibes.'],
        ];
    }

    /**
     * The demo squads 🛡️ — `captain` is an index into `DEMO_USER_EMAILS`.
     *
     * @return list<array<string, mixed>>
     */
    private function demoTeams(): array
    {
        return [
            ['name' => 'Chabahil Chargers', 'code' => 'CHARGERS-4X7K', 'motto' => 'Speed. Skill. Glory.', 'desc' => 'Tuesday and Friday nights at Dhanyentari, 7pm sharp. We play to win but nobody sits out — new faces get the first half. Court bill split four ways, boots and bibs on us 🥅', 'captain' => 0, 'level' => 'Advanced', 'color' => '#16a34a', 'home' => 'Dhanyentari Futsal Arena', 'w' => 18, 'l' => 4, 'd' => 3],
            ['name' => 'Lalitpur Legends', 'code' => 'LEGENDS-9PM3', 'motto' => 'Legacy in every goal', 'desc' => 'Sunday mornings at KickOff, then chiya and momos. Seven-a-side, defenders must talk, and yes we keep a league table nobody asked for 🏆', 'captain' => 3, 'level' => 'Advanced', 'color' => '#7c3aed', 'home' => 'KickOff Sports Hub', 'w' => 15, 'l' => 6, 'd' => 2],
            ['name' => 'Pokhara Panthers', 'code' => 'PANTHERS-7QRT', 'motto' => 'Hunt as one', 'desc' => 'Lakeside crowd, three times a week whenever the fog clears. Beginners welcome as long as you show up — we track attendance, not talent 🌄', 'captain' => 5, 'level' => 'Intermediate', 'color' => '#ea580c', 'home' => 'Lakeside Strikers Court', 'w' => 11, 'l' => 7, 'd' => 4],
            ['name' => 'Bhaktapur Ballers', 'code' => 'BALLERS-K3YD', 'motto' => 'Play beautiful', 'desc' => 'We are the crew that passes too much. Saturday evenings at GoalZone, Rs. 150 each, and the goalkeeper never pays 😄', 'captain' => 1, 'level' => 'Intermediate', 'color' => '#2563eb', 'home' => 'GoalZone Futsal Park', 'w' => 9, 'l' => 8, 'd' => 3],
            ['name' => 'Thamel Night Owls', 'code' => 'OWLS-MN4P', 'motto' => 'We own the night', 'desc' => 'Late shift only: midnight court at NightOwl after work. Learning group, laughs first, and we are genuinely terrible at defending set pieces 🦉', 'captain' => 4, 'level' => 'Beginner', 'color' => '#be123c', 'home' => 'NightOwl Futsal', 'w' => 5, 'l' => 9, 'd' => 2],
        ];
    }

    /**
     * Rosters as [teamIndex, userIndex, role]. Exactly one captain per team —
     * and every seeded member is a player account, because a venue owner runs a
     * court rather than turning out for a squad.
     *
     * @return list<array<int, mixed>>
     */
    private function demoTeamMemberships(): array
    {
        return [
            [0, 0, 'captain'], [0, 1, 'player'], [0, 2, 'player'], [0, 4, 'player'], [0, 5, 'player'],
            [1, 3, 'captain'], [1, 0, 'player'], [1, 4, 'player'], [1, 7, 'player'],
            [2, 5, 'captain'], [2, 1, 'player'], [2, 4, 'player'],
            [3, 1, 'captain'], [3, 2, 'player'], [3, 7, 'player'], [3, 0, 'player'],
            [4, 4, 'captain'], [4, 7, 'player'],
        ];
    }

    /**
     * Pending invitations as [teamIndex, userIndex, note] — the captain's side of
     * the consent rule: an invite never adds anyone, the player's own yes does.
     *
     * @return list<array<int, mixed>>
     */
    private function demoTeamInvites(): array
    {
        return [
            [0, 3, 'We lost our left-back to a knee injury — you played against us and I remember. Two nights a week, no trial game 🛡️'],
            [1, 5, 'Champions need depth 😄 Sunday mornings only, and we split the court four ways.'],
            [4, 0, 'We are the worst team in the league and the friendliest 🦉 an advanced player like you would change that.'],
        ];
    }

    /**
     * Pending join requests as [teamIndex, userIndex, message] — every requester
     * is deliberately not already a member of the squad they are asking to join.
     *
     * @return list<array<int, mixed>>
     */
    private function demoTeamJoinRequests(): array
    {
        return [
            [0, 7, 'Sunday league defender, and I live two minutes from the arena. Would love to join the Chargers! 🛡️'],
            [4, 2, 'Beginner goalkeeper. I can’t promise saves but I promise enthusiasm 🧤'],
            [2, 3, 'In Pokhara every weekend — happy to travel for the Panthers.'],
        ];
    }

    /**
     * Demo promo codes. `venueId` resolves a venue name to an id, so the same
     * list works for a fresh seed and for backfilling an old one.
     *
     * @return list<array<string, mixed>>
     */
    private function demoPromos(callable $venueId): array
    {
        $rows = [
            ['venue' => 'Dhanyentari Futsal Arena', 'values' => ['code' => 'EARLYBIRD15', 'title' => 'Early bird evenings', 'discount_type' => 'percent', 'discount_value' => 15, 'max_discount' => 600, 'min_booking_amount' => 2000, 'starts_at' => null, 'expires_at' => $this->d(21), 'usage_limit' => 40, 'per_user_limit' => 1, 'is_public' => true, 'is_active' => true]],
            ['venue' => 'Dhanyentari Futsal Arena', 'values' => ['code' => 'WEEKDAY10', 'title' => 'Fill the weekday slots', 'discount_type' => 'percent', 'discount_value' => 10, 'max_discount' => 0, 'min_booking_amount' => 0, 'starts_at' => null, 'expires_at' => $this->d(7), 'usage_limit' => 0, 'per_user_limit' => 2, 'is_public' => true, 'is_active' => true]],
            ['venue' => 'KickOff Sports Hub', 'values' => ['code' => 'ROOFTOP300', 'title' => 'Rooftop regulars', 'discount_type' => 'flat', 'discount_value' => 300, 'max_discount' => 0, 'min_booking_amount' => 1500, 'starts_at' => null, 'expires_at' => $this->d(14), 'usage_limit' => 25, 'per_user_limit' => 1, 'is_public' => false, 'is_active' => true]],
            ['venue' => 'KickOff Sports Hub', 'values' => ['code' => 'NEWYEAR25', 'title' => 'New year kickoff (finished)', 'discount_type' => 'percent', 'discount_value' => 25, 'max_discount' => 500, 'min_booking_amount' => 0, 'starts_at' => null, 'expires_at' => $this->d(-5), 'usage_limit' => 20, 'per_user_limit' => 1, 'is_public' => true, 'is_active' => true]],
            ['venue' => 'Lakeside Strikers Court', 'values' => ['code' => 'LAKESIDE20', 'title' => 'Lake breeze special', 'discount_type' => 'percent', 'discount_value' => 20, 'max_discount' => 500, 'min_booking_amount' => 1600, 'starts_at' => null, 'expires_at' => $this->d(3), 'usage_limit' => 15, 'per_user_limit' => 1, 'is_public' => true, 'is_active' => true]],
            ['venue' => 'NightOwl Futsal', 'values' => ['code' => 'MIDNIGHT50', 'title' => 'Midnight madness', 'discount_type' => 'percent', 'discount_value' => 50, 'max_discount' => 950, 'min_booking_amount' => 1900, 'starts_at' => null, 'expires_at' => $this->d(30), 'usage_limit' => 10, 'per_user_limit' => 1, 'is_public' => true, 'is_active' => true]],
        ];

        $out = [];

        foreach ($rows as $r) {
            $id = $venueId($r['venue']);

            if ($id === null) {
                continue;
            }

            $out[] = $r['values'] + ['venue_id' => $id];
        }

        return $out;
    }

    /**
     * Reviews used by the backfill path, where venue ids come from a name lookup
     * and user ids must exist in the database.
     *
     * @return list<array<string, mixed>>
     */
    private function demoReviewsFor(mixed $byName, int $unusedFallback = 0): array
    {
        $idOf = fn (string $name, int $fallback) => $byName[$name] ?? $fallback;

        return [
            ['venueId' => $idOf('Dhanyentari Futsal Arena', 1), 'userId' => 2, 'rating' => 5, 'message' => 'Best turf in town! The lights at night are amazing and the staff even helped us split teams. Felt like home 🏟️'],
            ['venueId' => $idOf('Dhanyentari Futsal Arena', 1), 'userId' => 5, 'rating' => 5, 'message' => 'Booked for my birthday game — they surprised us with extra balls and music. 10/10 vibes! 🎉'],
            ['venueId' => $idOf('Dhanyentari Futsal Arena', 1), 'userId' => 4, 'rating' => 4, 'message' => 'Great courts, gets busy on weekends so book early. Showers are clean! ⚽'],
            ['venueId' => $idOf('KickOff Sports Hub', 2), 'userId' => 1, 'rating' => 5, 'message' => 'Rooftop views while playing = unreal! Coffee after the game hits different here ☕'],
            ['venueId' => $idOf('KickOff Sports Hub', 2), 'userId' => 6, 'rating' => 4, 'message' => 'Cosy spot, friendly uncle at reception. Parking is a bit tight but worth it!'],
            ['venueId' => $idOf('KickOff Sports Hub', 2), 'userId' => 3, 'rating' => 5, 'message' => 'Came as a beginner goalkeeper, left feeling like a pro. Everyone cheered my saves 🧤'],
            ['venueId' => $idOf('GoalZone Futsal Park', 3), 'userId' => 8, 'rating' => 5, 'message' => 'Brought my little brother to the kids zone while we played — perfect family evening! 👨‍👩‍👧'],
            ['venueId' => $idOf('GoalZone Futsal Park', 3), 'userId' => 2, 'rating' => 4, 'message' => 'Juice bar after a sweaty game is genius 🧃 Turf is soft on the knees too.'],
            ['venueId' => $idOf('GoalZone Futsal Park', 3), 'userId' => 5, 'rating' => 5, 'message' => 'Coach gave us free tips for 10 minutes. My weak foot finally works! 😄'],
            ['venueId' => $idOf('Lakeside Strikers Court', 4), 'userId' => 3, 'rating' => 5, 'message' => 'Played with the lake breeze — magical evening! Beginners were so welcome 🌱'],
            ['venueId' => $idOf('Lakeside Strikers Court', 4), 'userId' => 1, 'rating' => 5, 'message' => 'Mountain view + futsal = my happy place. Booked again for next week already! 🏔️'],
            ['venueId' => $idOf('Lakeside Strikers Court', 4), 'userId' => 6, 'rating' => 4, 'message' => 'Beautiful court, slightly slippery after rain — but staff dried it fast. Great care! 🌧️'],
            ['venueId' => $idOf('Rhino Sports Complex', 5), 'userId' => 4, 'rating' => 5, 'message' => '7v7 with the full squad was epic! Physio stretched my cramp for free. Legends 🦏'],
            ['venueId' => $idOf('Rhino Sports Complex', 5), 'userId' => 8, 'rating' => 4, 'message' => 'Biggest courts I’ve played on. Gym warmup before the game is a game-changer 💪'],
            ['venueId' => $idOf('Rhino Sports Complex', 5), 'userId' => 2, 'rating' => 5, 'message' => 'Drove 2 hours for this and it was worth every minute. Proper football temple! 🙏'],
            ['venueId' => $idOf('NightOwl Futsal', 6), 'userId' => 5, 'rating' => 5, 'message' => 'Midnight futsal under neon lights hits different 🌙 Music, friends, goals — perfect night!'],
            ['venueId' => $idOf('NightOwl Futsal', 6), 'userId' => 1, 'rating' => 4, 'message' => 'DJ Friday was wild! Court gets a bit crowded late night but the energy is unmatched 🎧'],
            ['venueId' => $idOf('NightOwl Futsal', 6), 'userId' => 6, 'rating' => 5, 'message' => 'Night shift worker here — finally a place open when I’m free! Staff treats us like family 💜'],
        ];
    }

    /**
     * Demo leagues 🏆
     *
     * Two of them on purpose, because the two are different products:
     *
     * - **Chabahil Premier League** is an open 5v5 run by the venue owner:
     *   entries in, a round robin under way, results in the table, photos in the
     *   album, and a ledger that shows money arriving in instalments.
     * - **Sunday Circle Invitational** is a private 7v7 run by a *player*. It
     *   isn't listed for anyone, its squads were invited by hand, and its album
     *   is visible only to the teams in it.
     *
     * @return array{leagues: int, entries: int, fixtures: int, media: int}
     */
    private function seedLeagues(array $lookup): array
    {
        if (Tournament::count() > 0) {
            return ['leagues' => 0, 'entries' => 0, 'fixtures' => 0, 'media' => 0];
        }

        $ganesh = $lookup['userId']('ganesh@futsal.np');
        $aarav = $lookup['userId']('aarav@futsal.np');
        $dhanyentari = $lookup['venueId']('Dhanyentari Futsal Arena');
        $lakeside = $lookup['venueId']('Lakeside Strikers Court');
        $arenaA = $lookup['courtId']('Dhanyentari Futsal Arena');
        $lakeView = $lookup['courtId']('Lakeside Strikers Court');

        $chargers = $lookup['teamId']('CHARGERS-4X7K');
        $legends = $lookup['teamId']('LEGENDS-9PM3');
        $panthers = $lookup['teamId']('PANTHERS-7QRT');
        $ballers = $lookup['teamId']('BALLERS-K3YD');
        $owls = $lookup['teamId']('OWLS-MN4P');

        if (! $ganesh || ! $aarav || ! $dhanyentari || ! $chargers || ! $legends || ! $panthers || ! $ballers) {
            return ['leagues' => 0, 'entries' => 0, 'fixtures' => 0, 'media' => 0];
        }

        /* ------------------------------------------- open league, owner-hosted */
        $premier = Tournament::create([
            'name' => 'Chabahil Premier League — Season 1',
            'host_id' => $ganesh,
            'host_role' => 'owner',
            'venue_id' => $dhanyentari,
            'court_id' => $arenaA,
            'format' => '5v5',
            'mode' => 'round_robin',
            'third_place' => false,
            'group_size' => 4,
            'max_teams' => 6,
            'entry_fee' => 6000,
            'deposit_percent' => 25,
            'refund_percent' => 10,
            'prize_pool' => 30000,
            'prize_breakdown' => "Champion: Rs. 18,000\nRunner-up: Rs. 8,000\nTop scorer: Rs. 4,000",
            'starts_at' => $this->d(-14),
            'ends_at' => $this->d(21),
            'closes_at' => $this->d(4),
            'match_days' => 'Sat & Sun mornings, 7–9 AM',
            'visibility' => 'public',
            'status' => 'ongoing',
            'description' => 'Five-a-side, six squads, one table. Saturday and Sunday mornings at Dhanyentari with proper referees, match balls and a scorer’s sheet — the winners take the cup and the cash.',
            'rules' => '5v5 • 2 × 20 minute halves • rolling subs • no slide tackles from behind • a player sent off misses the next fixture • teams short of players may borrow from the league’s bench list, no ringers.',
            'contact_phone' => '9841000007',
            'banner_url' => Futsal::VENUE_IMAGES[0],
        ]);

        $entries = 0;

        $entry = function (?int $teamId, string $status, int $paidAmount, array $opts = []) use ($premier, $ganesh, &$entries) {
            if (! $teamId) {
                return;
            }

            $row = TournamentTeam::create([
                'tournament_id' => $premier->id,
                'team_id' => $teamId,
                'status' => $status,
                'requested_by' => $opts['by'] ?? 0,
                'message' => $opts['message'] ?? '',
                'refunded_amount' => $opts['refunded'] ?? 0,
                'decided_by' => $status === 'approved' ? $ganesh : null,
                'decided_at' => $status === 'approved' ? now() : null,
            ]);

            $entries++;

            if ($paidAmount <= 0) {
                return;
            }

            // The ledger names the captain who paid — the same shape a real
            // "record cash" write produces.
            $captainId = (int) (Team::find($teamId)?->captain_id ?? 0);

            TournamentPayment::create([
                'tournament_id' => $premier->id,
                'team_id' => $teamId,
                'user_id' => $captainId,
                'kind' => 'entry',
                'amount' => $paidAmount,
                'method' => 'eSewa',
                'reference' => 'Entry fee',
                'recorded_by' => $ganesh,
            ]);

            $row->forceFill(['paid_amount' => $paidAmount])->save();
        };

        $entry($chargers, 'approved', 6000);
        $entry($legends, 'approved', 6000);
        $entry($panthers, 'approved', 3000, ['message' => 'Half now, half after Dashain 🙏']);
        $entry($ballers, 'approved', 1500);
        $entry($owls, 'requested', 0, [
            'message' => 'Midnight crew here — we’d love a Sunday slot if one is left 🌙',
            'by' => $lookup['userId']('elish@futsal.np') ?? 0,
        ]);

        // Round robin among the four squads that are in, four of six games played.
        $fixtures = [
            [$chargers, $legends, 4, 3, $this->d(-7), '07:00'],
            [$panthers, $ballers, 2, 2, $this->d(-7), '08:00'],
            [$chargers, $panthers, 6, 1, $this->d(-3), '07:00'],
            [$legends, $ballers, 3, 5, $this->d(-3), '08:00'],
            [$chargers, $ballers, null, null, $this->d(6), '07:00'],
            [$legends, $panthers, null, null, $this->d(6), '08:00'],
        ];

        $fixtureCount = 0;
        $playedMatchId = null;

        foreach ($fixtures as [$home, $away, $hs, $as, $date, $start]) {
            if (! $home || ! $away) {
                continue;
            }

            $played = $hs !== null && $as !== null;

            $match = TournamentMatch::create([
                'tournament_id' => $premier->id,
                'round' => 'League',
                'home_team_id' => $home,
                'away_team_id' => $away,
                'date' => $date,
                'start_time' => $start,
                'court_id' => $arenaA,
                'home_score' => $played ? $hs : null,
                'away_score' => $played ? $as : null,
                'status' => $played ? 'played' : 'scheduled',
                'updated_by' => $ganesh,
            ]);

            $fixtureCount++;

            if ($played && $playedMatchId === null) {
                $playedMatchId = $match->id;
            }
        }

        // The album: one fixture photo only the two squads in it can see, and
        // one league-wide link every squad in the league can open.
        $album = [
            ['url' => Futsal::VENUE_IMAGES[1], 'caption' => 'Opening weekend — Chargers vs Legends went to the last minute ⚽', 'matchId' => $playedMatchId, 'credit' => 'Photos by Ganesh'],
            ['url' => Futsal::VENUE_IMAGES[3], 'caption' => 'Full league album on Google Drive — every fixture, every angle 📸', 'matchId' => null, 'credit' => 'Drive folder'],
        ];

        $mediaCount = 0;

        foreach ($album as $a) {
            TournamentMedia::create([
                'tournament_id' => $premier->id,
                'match_id' => $a['matchId'],
                'kind' => 'link',
                'url' => $a['url'],
                'caption' => $a['caption'],
                'credit' => $a['credit'],
                'uploaded_by' => $ganesh,
            ]);

            $mediaCount++;
        }

        /* ------------------------------------- private league, player-hosted */
        if ($lakeside && $owls) {
            $private = Tournament::create([
                'name' => 'Sunday Circle Invitational',
                'host_id' => $aarav,
                'host_role' => 'player',
                'venue_id' => $lakeside,
                'court_id' => $lakeView,
                'format' => '7v7',
                'mode' => 'round_robin',
                'third_place' => false,
                'group_size' => 4,
                'max_teams' => 4,
                'entry_fee' => 3000,
                'deposit_percent' => 25,
                'refund_percent' => 10,
                'prize_pool' => 10000,
                'prize_breakdown' => "Winners: Rs. 7,000\nBest keeper: Rs. 3,000",
                'starts_at' => $this->d(9),
                'ends_at' => $this->d(37),
                'closes_at' => $this->d(5),
                'match_days' => 'Sunday mornings, 8–10 AM',
                'visibility' => 'private',
                'status' => 'registration',
                'description' => 'Four squads, invited by hand, one round robin over a month by the lake. We keep it small so everybody plays every week — and the album stays inside the group.',
                'rules' => '7v7 • 25 minute halves • rolling subs • no entry without the deposit • leave the ground cleaner than you found it 🌿',
                'contact_phone' => '9841000001',
                'banner_url' => Futsal::VENUE_IMAGES[2],
            ]);

            // Invited by hand, and nobody is in yet: the invitations are the
            // only door into a private league.
            foreach ([$owls, $panthers] as $teamId) {
                TournamentTeam::create([
                    'tournament_id' => $private->id,
                    'team_id' => $teamId,
                    'status' => 'invited',
                    'requested_by' => $aarav,
                    'message' => 'Four squads by the lake — say yes and the fixture list goes up 🌄',
                ]);

                $entries++;
            }
        }

        return [
            'leagues' => Tournament::count(),
            'entries' => $entries,
            'fixtures' => $fixtureCount,
            'media' => $mediaCount,
        ];
    }
}
