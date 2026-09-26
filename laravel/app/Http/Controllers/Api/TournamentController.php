<?php

namespace App\Http\Controllers\Api;

use App\Models\Court;
use App\Models\Team;
use App\Models\TeamMember;
use App\Models\Tournament;
use App\Models\TournamentMatch;
use App\Models\TournamentPayment;
use App\Models\TournamentTeam;
use App\Models\User;
use App\Models\Venue;
use App\Services\Notifier;
use App\Support\Futsal;
use App\Support\League;
use App\Support\LeagueStore;
use App\Support\Teams;
use App\Support\Validation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Leagues 🏆 — the listing, the host's control room, and the entry desk.
 *
 * A league is a fixture list with a table, or a bracket, or a group stage that
 * turns into one. Everything that decides *what shape* the competition is lives
 * in `App\Support\League`; everything that reads rows lives in
 * `App\Support\LeagueStore`; this file is the conversation with the app.
 */
class TournamentController extends ApiController
{
    /**
     * GET /api/tournaments — the league board.
     *
     * Public leagues, plus any private league this viewer has a right to see
     * (they host it, or one of their squads was invited or admitted).
     * `viewerId` is what keeps a private league private.
     */
    public function index(Request $request): JsonResponse
    {
        $leagues = LeagueStore::listLeagues([
            'viewerId' => (int) $request->query('viewerId', 0) ?: 0,
            'hostId' => (int) $request->query('hostId', 0) ?: 0,
            'venueId' => (int) $request->query('venueId', 0) ?: 0,
            'status' => trim((string) $request->query('status', '')),
            'q' => mb_substr(trim((string) $request->query('q', '')), 0, 60),
            'limit' => min(100, max(1, (int) $request->query('limit', 60) ?: 60)),
        ]);

        return $this->ok(['leagues' => $leagues]);
    }

    /**
     * POST /api/tournaments — host a league 🎉
     *
     * Any logged-in player *or* venue owner can run one; `hostRole` is recorded
     * so the console can label it, but it grants no extra powers. What a host
     * does get is the whole control room: entries, the ledger, the fixture list
     * and the album, all gated on `hostId === userId` in the routes below.
     */
    public function store(Request $request): JsonResponse
    {
        $hostId = (int) $request->input('hostId', 0);

        if ($hostId <= 0) {
            return $this->fail('Log in to host a league 🔒', 400);
        }

        $host = User::find($hostId);

        if (! $host) {
            return $this->fail('That account no longer exists 🔒', 404);
        }

        $name = trim((string) $request->input('name', ''));
        $venueId = (int) $request->input('venueId', 0);
        $courtId = (int) $request->input('courtId', 0) ?: 0;
        $format = (string) $request->input('format', '5v5');
        // How the competition decides a winner — round robin by default, so an
        // older client posting without `mode` gets exactly what it always got.
        $mode = (string) $request->input('mode', 'round_robin');
        $thirdPlace = $request->boolean('thirdPlace') || $request->input('thirdPlace') === 'true';
        $groupSize = (float) $request->input('groupSize', 4);
        $maxTeams = (float) $request->input('maxTeams', 0);
        $entryFeeRaw = $request->input('entryFee');
        $entryFee = ($entryFeeRaw === '' || $entryFeeRaw === null) ? 0 : (float) $entryFeeRaw;
        $depositPercent = (float) $request->input('depositPercent', 25);
        $refundPercent = (float) $request->input('refundPercent', 10);
        $prizePoolRaw = $request->input('prizePool');
        $prizePool = ($prizePoolRaw === '' || $prizePoolRaw === null) ? 0 : (float) $prizePoolRaw;
        $prizeBreakdown = trim((string) $request->input('prizeBreakdown', ''));
        $startsAt = trim((string) $request->input('startsAt', ''));
        $endsAt = trim((string) $request->input('endsAt', ''));
        $closesAt = trim((string) $request->input('closesAt', ''));
        $matchDays = trim((string) $request->input('matchDays', ''));
        $visibility = (string) $request->input('visibility', 'public');
        $description = trim((string) $request->input('description', ''));
        $rules = trim((string) $request->input('rules', ''));
        $contactPhone = trim((string) $request->input('contactPhone', ''));
        $bannerUrl = (string) $request->input('bannerUrl', '');

        $venue = Venue::find($venueId);

        $error = Validation::firstError(
            Validation::leagueName($name),
            $venue ? null : 'Pick the ground this league plays on 🏟️',
            in_array($format, League::LEAGUE_FORMATS, true) ? null : 'Format must be one of '.implode(', ', League::LEAGUE_FORMATS).' 🥅',
            Validation::maxTeams($maxTeams),
            League::leagueModeError($mode),
            League::groupSetupError(['mode' => $mode, 'groupSize' => $groupSize, 'maxTeams' => $maxTeams]),
            Validation::entryFee($entryFee),
            League::depositPercentError($depositPercent),
            League::refundPercentError($refundPercent),
            Validation::prizePool($prizePool),
            Validation::prizeBreakdown($prizeBreakdown),
            Validation::leagueDates($startsAt, $endsAt, $closesAt),
            Validation::matchDays($matchDays),
            in_array($visibility, League::LEAGUE_VISIBILITIES, true) ? null : 'Visibility must be public or private 🔒',
            Validation::leagueText($description, ['label' => 'Description', 'max' => League::LEAGUE_DESCRIPTION_MAX]),
            Validation::leagueText($rules, ['label' => 'Rules', 'max' => League::LEAGUE_RULES_MAX]),
            // A phone number is how a captain reaches the host on match day, so
            // a bad one is worse than none — but it stays optional.
            Validation::phone($contactPhone, ['required' => false]),
            $entryFee > League::LEAGUE_MAX_ENTRY_FEE ? 'Entry fee is too high 💰' : null,
        );

        if ($error) {
            return $this->fail($error, 400);
        }

        $court = null;

        if ($courtId > 0) {
            $court = Court::find($courtId);

            if (! $court || (int) $court->venue_id !== (int) $venue->id) {
                return $this->fail('That pitch isn’t at the ground you picked 🥅', 400);
            }
        }

        $league = Tournament::create([
            'name' => $name,
            'host_id' => $hostId,
            'host_role' => (int) $venue->owner_id === $hostId ? 'owner' : 'player',
            'venue_id' => $venue->id,
            'court_id' => $courtId > 0 ? $courtId : null,
            'format' => $format,
            'mode' => $mode,
            // A third-place game only means something in a mode with a bracket.
            'third_place' => League::modeHasBracket($mode) ? $thirdPlace : false,
            'group_size' => min(8, max(2, (int) $groupSize ?: 4)),
            'max_teams' => (int) $maxTeams,
            'entry_fee' => (int) $entryFee,
            'deposit_percent' => (int) $depositPercent,
            'refund_percent' => (int) $refundPercent,
            'prize_pool' => (int) $prizePool,
            'prize_breakdown' => $prizeBreakdown,
            'starts_at' => $startsAt,
            'ends_at' => $endsAt,
            'closes_at' => $closesAt,
            'match_days' => $matchDays,
            'visibility' => $visibility,
            'status' => 'registration',
            'description' => $description,
            'rules' => $rules,
            'contact_phone' => $contactPhone,
            'banner_url' => mb_substr($bannerUrl, 0, 2000000),
        ]);

        return $this->ok(['league' => $league], 201);
    }

    /** GET /api/tournaments/{id} — everything one league page needs, filtered for the viewer. */
    public function show(Request $request, int $id): JsonResponse
    {
        $detail = LeagueStore::leagueDetail($id, (int) $request->query('viewerId', 0) ?: 0);

        if (! $detail) {
            return $this->fail('That league no longer exists 🛡️', 404);
        }

        return $this->ok(['league' => $detail]);
    }

    /**
     * PATCH /api/tournaments/{id} — the host edits the deal ✍️
     *
     * Size, money, dates, format, visibility and status all live here. The two
     * guards that matter: only the host may patch, and the squad cap can never
     * be lowered below the squads already admitted — a league can't shrink out
     * from under a team that paid to be in it.
     */
    public function update(Request $request, int $id): JsonResponse
    {
        $hostId = (int) $request->input('hostId', 0);

        $current = Tournament::find($id);

        if (! $current) {
            return $this->fail('That league no longer exists 🛡️', 404);
        }

        if ((int) $current->host_id !== $hostId) {
            return $this->fail('Only the host can change the league 👑', 403);
        }

        $entries = TournamentTeam::where('tournament_id', $id)->get();
        $approved = $entries->filter(fn ($e) => $e->status === League::TEAM_APPROVED)->count();

        $pick = function (string $key, mixed $default) use ($request) {
            return $request->has($key) ? $request->input($key) : $default;
        };

        $name = $request->has('name') ? trim((string) $request->input('name')) : $current->name;
        $format = $request->has('format') ? (string) $request->input('format') : $current->format;
        $mode = $request->has('mode') ? (string) $request->input('mode') : $current->mode;
        $thirdPlace = $request->has('thirdPlace')
            ? ($request->boolean('thirdPlace') || $request->input('thirdPlace') === 'true')
            : (bool) $current->third_place;
        $groupSize = $request->has('groupSize') ? (float) $request->input('groupSize') : (float) $current->group_size;
        $maxTeams = $request->has('maxTeams') ? (float) $request->input('maxTeams') : (float) $current->max_teams;
        $entryFee = $request->has('entryFee') ? (float) $request->input('entryFee') : (float) $current->entry_fee;
        $depositPercent = $request->has('depositPercent') ? (float) $request->input('depositPercent') : (float) $current->deposit_percent;
        $refundPercent = $request->has('refundPercent') ? (float) $request->input('refundPercent') : (float) $current->refund_percent;
        $prizePool = $request->has('prizePool') ? (float) $request->input('prizePool') : (float) $current->prize_pool;
        $prizeBreakdown = $request->has('prizeBreakdown') ? trim((string) $request->input('prizeBreakdown')) : $current->prize_breakdown;
        $startsAt = $request->has('startsAt') ? trim((string) $request->input('startsAt')) : $current->starts_at;
        $endsAt = $request->has('endsAt') ? trim((string) $request->input('endsAt')) : $current->ends_at;
        $closesAt = $request->has('closesAt') ? trim((string) $request->input('closesAt')) : $current->closes_at;
        $matchDays = $request->has('matchDays') ? trim((string) $request->input('matchDays')) : $current->match_days;
        $visibility = $request->has('visibility') ? (string) $request->input('visibility') : $current->visibility;
        $status = $request->has('status') ? (string) $request->input('status') : $current->status;
        $description = $request->has('description') ? trim((string) $request->input('description')) : $current->description;
        $rules = $request->has('rules') ? trim((string) $request->input('rules')) : $current->rules;
        $contactPhone = $request->has('contactPhone') ? trim((string) $request->input('contactPhone')) : $current->contact_phone;
        $bannerUrl = $request->has('bannerUrl') ? (string) $request->input('bannerUrl') : $current->banner_url;
        $venueId = $request->has('venueId') ? ((int) $request->input('venueId') ?: null) : $current->venue_id;
        $courtId = $request->has('courtId') ? ((int) $request->input('courtId') ?: null) : $current->court_id;

        $venue = $venueId ? Venue::find($venueId) : null;
        $court = $courtId ? Court::find($courtId) : null;

        $error = Validation::firstError(
            Validation::leagueName($name),
            $venue ? null : 'Pick the ground this league plays on 🏟️',
            in_array($format, League::LEAGUE_FORMATS, true) ? null : 'Format must be one of '.implode(', ', League::LEAGUE_FORMATS).' 🥅',
            Validation::maxTeams($maxTeams),
            League::leagueModeError($mode),
            League::groupSetupError(['mode' => $mode, 'groupSize' => $groupSize, 'maxTeams' => $maxTeams]),
            $maxTeams < $approved
                ? "{$approved} squads are already in — the league can’t be smaller than that 👥"
                : null,
            Validation::entryFee($entryFee),
            League::depositPercentError($depositPercent),
            League::refundPercentError($refundPercent),
            Validation::prizePool($prizePool),
            Validation::prizeBreakdown($prizeBreakdown),
            Validation::leagueDates($startsAt, $endsAt, $closesAt),
            Validation::matchDays($matchDays),
            in_array($visibility, League::LEAGUE_VISIBILITIES, true) ? null : 'Visibility must be public or private 🔒',
            in_array($status, League::LEAGUE_STATUSES, true) ? null : 'Unknown league status 🏷️',
            Validation::leagueText($description, ['label' => 'Description', 'max' => League::LEAGUE_DESCRIPTION_MAX]),
            Validation::leagueText($rules, ['label' => 'Rules', 'max' => League::LEAGUE_RULES_MAX]),
            Validation::phone($contactPhone, ['required' => false]),
            $court && $venue && (int) $court->venue_id !== (int) $venue->id
                ? 'That pitch isn’t at the ground you picked 🥅'
                : null,
        );

        if ($error) {
            return $this->fail($error, 400);
        }

        /*
         * The competition type is fixed once there is anything to play 🏆
         *
         * A bracket and a league table are not the same shape: switching a drawn
         * round robin into a knockout would leave fixtures that belong to
         * neither, and switching a bracket back would strand the slots waiting on
         * winners. So the host picks the mode while entries are open, and after
         * the first fixture the answer is no — cancel and re-host instead.
         */
        if ($mode !== $current->mode) {
            $fixtures = TournamentMatch::where('tournament_id', $id)->count();

            if ($fixtures > 0) {
                return $this->fail(
                    'Fixtures are already drawn, so the competition type can’t change from '
                    .League::modeLabel((string) $current->mode)['label'].' to '.League::modeLabel($mode)['label']
                    .' 🏆 Cancel this league and host a new one in the shape you want.',
                    409
                );
            }
        }

        $current->forceFill([
            'name' => $name,
            'venue_id' => $venueId,
            'court_id' => $courtId,
            'format' => $format,
            'mode' => $mode,
            'third_place' => League::modeHasBracket($mode) ? $thirdPlace : false,
            'group_size' => min(8, max(2, (int) $groupSize ?: 4)),
            'max_teams' => (int) $maxTeams,
            'entry_fee' => (int) $entryFee,
            'deposit_percent' => (int) $depositPercent,
            'refund_percent' => (int) $refundPercent,
            'prize_pool' => (int) $prizePool,
            'prize_breakdown' => $prizeBreakdown,
            'starts_at' => $startsAt,
            'ends_at' => $endsAt,
            'closes_at' => $closesAt,
            'match_days' => $matchDays,
            'visibility' => $visibility,
            'status' => $status,
            'description' => $description,
            'rules' => $rules,
            'contact_phone' => $contactPhone,
            'banner_url' => mb_substr($bannerUrl, 0, 2000000),
        ])->save();

        return $this->ok(['league' => $current->fresh()]);
    }

    /* ─────────────────────────────────────────────────────────────────────── */
    /*  Entry desk: /api/tournaments/{id}/teams                                */
    /* ─────────────────────────────────────────────────────────────────────── */

    /**
     * GET /api/tournaments/{id}/teams — who is in, and who is knocking 🚪
     *
     * Everybody in a public league can see the squads that are *in* — that's the
     * point of a league. Only the host sees the queue of requests and
     * invitations still open, because a squad asking to join hasn't agreed to
     * anything yet.
     */
    public function teamsIndex(Request $request, int $id): JsonResponse
    {
        $access = LeagueStore::leagueAccess($id, (int) $request->query('userId', 0) ?: 0);

        if (! $access) {
            return $this->fail('That league no longer exists 🛡️', 404, ['teams' => []]);
        }

        $tournament = $access['tournament'];
        $allTeams = \App\Models\Team::all()->keyBy('id');
        $allUsers = User::all()->keyBy('id');
        $members = TeamMember::all();

        // Fixtures decide whose money is locked, so the panel can say it up
        // front instead of letting a captain discover it by being refused.
        $fixtures = TournamentMatch::where('tournament_id', $id)->get();

        $rows = $access['rows']
            ->filter(fn ($r) => $access['isHost'] || $r->status === League::TEAM_APPROVED)
            ->map(function ($r) use ($allTeams, $allUsers, $members, $tournament, $fixtures) {
                $team = $allTeams->get((int) $r->team_id);

                return [
                    'teamId' => (int) $r->team_id,
                    'name' => $team->name ?? 'Removed squad',
                    'teamCode' => $team->team_code ?? '',
                    'logoColor' => $team->logo_color ?? '#16a34a',
                    'level' => $team->level ?? 'Intermediate',
                    'homeGround' => $team->home_ground ?? '',
                    'captainId' => $team->captain_id ?? 0,
                    'captainName' => $allUsers->get((int) ($team->captain_id ?? 0))?->name ?? '',
                    'memberCount' => $members->filter(fn ($m) => (int) $m->team_id === (int) $r->team_id)->count(),
                    'status' => $r->status,
                    'message' => $r->message,
                    'paidAmount' => (int) $r->paid_amount,
                    'refundedAmount' => (int) $r->refunded_amount,
                    'payment' => League::paymentState([
                        'entryFee' => (int) $tournament->entry_fee,
                        'paidAmount' => (int) $r->paid_amount,
                        'refundedAmount' => (int) $r->refunded_amount,
                        'depositPercent' => $tournament->deposit_percent,
                        'refundPercent' => $tournament->refund_percent,
                        'lock' => League::moneyLockedFor((int) $r->team_id, $fixtures->all()),
                        'status' => $r->status,
                    ]),
                    'createdAt' => $r->created_at,
                ];
            })
            ->sortBy(fn ($r) => $r['name'])
            ->values()
            ->all();

        return $this->ok([
            'teams' => $rows,
            'meta' => [
                'entryFee' => (int) $tournament->entry_fee,
                'deposit' => League::depositFor((int) $tournament->entry_fee, $tournament->deposit_percent),
                'approved' => collect($rows)->filter(fn ($r) => $r['status'] === League::TEAM_APPROVED)->count(),
                'maxTeams' => (int) $tournament->max_teams,
                'isHost' => $access['isHost'],
                'visibility' => $tournament->visibility,
            ],
        ]);
    }

    /**
     * POST /api/tournaments/{id}/teams — the entry desk 🛡️
     *
     * Five actions, one per real conversation between a host and a captain:
     * `request`, `invite`, `approve`, `reject`, `withdraw`.
     */
    public function teamsAction(Request $request, int $id): JsonResponse
    {
        $action = (string) $request->input('action', '');

        $league = Tournament::find($id);

        if (! $league) {
            return $this->fail('That league no longer exists 🛡️', 404);
        }

        $teamId = (int) $request->input('teamId', 0);
        $team = Team::find($teamId);

        if (! $team) {
            return $this->fail('Pick a squad first 🛡️', 404);
        }

        $entries = TournamentTeam::where('tournament_id', $id)->get();
        $row = $entries->firstWhere('team_id', $teamId);
        $approvedCount = $entries->filter(fn ($r) => $r->status === League::TEAM_APPROVED)->count();
        $host = User::find((int) $league->host_id);
        $captain = User::find((int) $team->captain_id);
        $hostLink = "/leagues/{$id}";

        /* ---------------------------------------------------------- request */
        if ($action === 'request') {
            $userId = (int) $request->input('userId', 0);

            if (! $userId || (int) $team->captain_id !== $userId) {
                return $this->fail('Only the captain can enter the squad 🛡️', 403);
            }

            if ($league->visibility === 'private') {
                return $this->fail(
                    'This league is private — the host invites squads directly. Ask them for an invite and the door opens. 🔒',
                    403
                );
            }

            if ($league->status === 'completed' || $league->status === 'cancelled') {
                return $this->fail("This league is {$league->status} — entries are closed 🏁", 409);
            }

            if ($row && League::isPendingEntry((string) $row->status)) {
                return $this->fail("You’ve already asked to join {$league->name} — hang tight ⏳", 409);
            }

            if ($row && $row->status === League::TEAM_APPROVED) {
                return $this->fail("{$team->name} is already in this league ✅", 409);
            }

            if ($approvedCount >= (int) $league->max_teams) {
                return $this->fail(
                    "The league is full ({$approvedCount}/{$league->max_teams}) 👥 — ask the host to open more spots.",
                    409
                );
            }

            $msgError = Validation::inviteMessage($request->input('message'));

            if ($msgError) {
                return $this->fail($msgError, 400);
            }

            $this->upsertEntry((int) $id, $teamId, [
                'status' => League::TEAM_REQUESTED,
                'requested_by' => $userId,
                'message' => trim((string) $request->input('message', '')),
                'decided_by' => null,
                'decided_at' => null,
            ]);

            Notifier::notify(
                (int) $league->host_id,
                'league',
                "🛡️ {$team->name} wants in — {$league->name}",
                ($captain->name ?? 'The captain')." asked to join with {$team->name}. Open the league page to approve or decline — remember a place is held once the "
                .Futsal::formatNPR(League::depositFor((int) $league->entry_fee, $league->deposit_percent)).' deposit is in.',
                $hostLink
            );

            return $this->ok(['ok' => true, 'message' => 'Request sent to '.($host->name ?? 'the host').' — you’ll hear back soon 📨']);
        }

        /* ----------------------------------------------------------- invite */
        if ($action === 'invite') {
            $hostId = (int) $request->input('hostId', 0);

            if ((int) $league->host_id !== $hostId) {
                return $this->fail('Only the host can invite squads 👑', 403);
            }

            if ($league->status === 'completed' || $league->status === 'cancelled') {
                return $this->fail('This league is over — no more invites 🏁', 409);
            }

            if (! Teams::canBeInvitedToTeam($captain->role ?? 'player')) {
                return $this->fail('That captain runs a venue account — only player squads can enter a league 🏟️', 403);
            }

            if ($row && ($row->status === League::TEAM_APPROVED || League::isPendingEntry((string) $row->status))) {
                return $this->fail("{$team->name} is already {$row->status} in this league 📋", 409);
            }

            if ($approvedCount >= (int) $league->max_teams) {
                return $this->fail("All {$league->max_teams} spots are taken — widen the league first 👥", 409);
            }

            $msgError = Validation::inviteMessage($request->input('message'));

            if ($msgError) {
                return $this->fail($msgError, 400);
            }

            $this->upsertEntry((int) $id, $teamId, [
                'status' => League::TEAM_INVITED,
                'requested_by' => $hostId,
                'message' => trim((string) $request->input('message', '')),
                'decided_by' => null,
                'decided_at' => null,
            ]);

            $quote = trim((string) $request->input('message', ''));

            Notifier::notify(
                (int) $team->captain_id,
                'league',
                "🏆 {$league->name} invited {$team->name}!",
                ($host->name ?? 'The host').' invited you to a '.$league->format.' league at '
                .((int) $league->entry_fee > 0 ? 'Rs. '.$league->entry_fee.' per squad' : 'no entry fee')
                .'. A place is locked when the deposit is paid — open the league to see the details.'
                .($quote !== '' ? " \"{$quote}\"" : ''),
                $hostLink
            );

            return $this->ok(['ok' => true, 'message' => "Invite sent to {$team->name} 📨"]);
        }

        /* ---------------------------------------------------------- approve */
        if ($action === 'approve') {
            $hostId = (int) $request->input('hostId', 0);

            if ((int) $league->host_id !== $hostId) {
                return $this->fail('Only the host decides entries 👑', 403);
            }

            if (! $row) {
                return $this->fail('That squad hasn’t asked to join 🛡️', 404);
            }

            if ($row->status === League::TEAM_APPROVED) {
                return $this->fail("{$team->name} is already in ✅", 409);
            }

            if (! League::isPendingEntry((string) $row->status)) {
                return $this->fail('That entry is closed — invite them again 📨', 409);
            }

            if ($approvedCount >= (int) $league->max_teams) {
                return $this->fail(
                    "The league is full ({$approvedCount}/{$league->max_teams}) — widen it or decline someone 👥",
                    409
                );
            }

            // A place in the league is held by money, not by a promise.
            $gate = League::approvalCheck([
                'entryFee' => (int) $league->entry_fee,
                'paidAmount' => (int) $row->paid_amount,
                'depositPercent' => $league->deposit_percent,
            ]);

            if (! ($gate['ok'] ?? false)) {
                return $this->fail($gate['reason'], 402, ['reason' => 'deposit_due']);
            }

            $row->forceFill([
                'status' => League::TEAM_APPROVED,
                'decided_by' => $hostId,
                'decided_at' => now(),
                'updated_at' => now(),
            ])->save();

            $due = League::paymentState([
                'entryFee' => (int) $league->entry_fee,
                'paidAmount' => (int) $row->paid_amount,
                'depositPercent' => $league->deposit_percent,
            ])['due'];

            Notifier::notify(
                (int) $team->captain_id,
                'league',
                "🎉 {$team->name} is in {$league->name}!",
                ($host->name ?? 'The host').' approved your entry. '
                .($due > 0
                    ? "Rs. {$due} of the entry fee is still open — settle it when you can."
                    : 'Entry fee settled — good luck!')
                .' Fixtures and photos will show up on the league page.',
                $hostLink
            );

            return $this->ok(['ok' => true, 'message' => "{$team->name} is in the league 🎉"]);
        }

        /* ----------------------------------------------------------- reject */
        if ($action === 'reject') {
            $hostId = (int) $request->input('hostId', 0);

            if ((int) $league->host_id !== $hostId) {
                return $this->fail('Only the host decides entries 👑', 403);
            }

            if (! $row) {
                return $this->fail('That squad hasn’t asked to join 🛡️', 404);
            }

            $row->forceFill([
                'status' => League::TEAM_REJECTED,
                'decided_by' => $hostId,
                'decided_at' => now(),
                'updated_at' => now(),
            ])->save();

            Notifier::notify(
                (int) $team->captain_id,
                'league',
                "🚫 {$league->name} couldn’t take {$team->name}",
                ($host->name ?? 'The host').' declined the entry. Nothing is charged, and you’re welcome to ask again if a spot opens up.',
                $hostLink
            );

            return $this->ok(['ok' => true, 'message' => "{$team->name}’s request was declined 🚫"]);
        }

        /* --------------------------------------------------------- withdraw */
        if ($action === 'withdraw') {
            // The captain's panel sends `userId`, the host console sends
            // `hostId` — both are "who is asking", and only one of them used to
            // be read, which meant a host pressing "Remove & refund" was always
            // told no.
            $userId = (int) $request->input('userId', 0) ?: (int) $request->input('hostId', 0);
            $isHost = (int) $league->host_id === $userId;
            $isCaptain = (int) $team->captain_id === $userId;

            if (! $isHost && ! $isCaptain) {
                return $this->fail('Only the squad’s captain or the host can withdraw an entry 🚪', 403);
            }

            if (! $row) {
                return $this->fail('That squad isn’t in this league 🛡️', 404);
            }

            if ($row->status === League::TEAM_WITHDRAWN) {
                return $this->fail("{$team->name} already withdrew 🏳️", 409);
            }

            /*
             * The money lock 🔒 — "a tenth back if you walk" is the deal, until
             * the first kick-off. From the moment this squad's game starts the
             * entry fee is the league's: the host has paid for a pitch and built
             * a fixture list around them. So a captain can't withdraw at all
             * once they've taken the field. The host may still take a squad out
             * — somebody has to be able to — but nothing is refunded on the way.
             */
            $fixtures = TournamentMatch::where('tournament_id', $id)->get();
            $lock = League::moneyLockedFor($teamId, $fixtures->all());
            $gate = League::withdrawCheck(['isHost' => $isHost, 'lock' => $lock, 'teamName' => $team->name]);

            if (! ($gate['ok'] ?? false)) {
                return $this->fail($gate['reason'], 409);
            }

            $paid = (int) $row->paid_amount;
            $refund = $gate['refundBlocked'] ? 0 : League::refundFor($paid, $league->refund_percent);

            if ($refund > 0) {
                TournamentPayment::create([
                    'tournament_id' => $id,
                    'team_id' => $teamId,
                    'user_id' => $team->captain_id,
                    'kind' => 'refund',
                    'amount' => $refund,
                    'method' => 'Host refund',
                    'reference' => "{$league->refund_percent}% back on withdrawal",
                    'recorded_by' => $userId,
                ]);
            }

            $row->forceFill([
                'status' => League::TEAM_WITHDRAWN,
                'decided_by' => $userId,
                'decided_at' => now(),
                'updated_at' => now(),
            ])->save();

            LeagueStore::recalcTeamTotals((int) $id, $teamId);

            // A withdrawn squad's fixtures become history: drop the ones still
            // to be played so the table isn't left with games nobody will
            // turn up for.
            $upcoming = TournamentMatch::where('tournament_id', $id)->where('status', 'scheduled')->get();

            foreach ($upcoming as $m) {
                if ((int) $m->home_team_id === $teamId || (int) $m->away_team_id === $teamId) {
                    $m->forceFill([
                        'status' => 'void',
                        'notes' => "{$team->name} withdrew",
                        'updated_by' => $userId,
                    ])->save();
                }
            }

            $kept = max(0, $paid - $refund);

            Notifier::notify(
                (int) $league->host_id,
                'league',
                "🏳️ {$team->name} withdrew — {$league->name}",
                ($isHost ? 'You' : ($captain->name ?? 'The captain'))." pulled {$team->name} out."
                .($paid > 0
                    ? ($gate['refundBlocked']
                        ? ' No refund — their money was locked once the game kicked off, so '.Futsal::formatNPR($kept).' stays with the league 🔒'
                        : ' '.Futsal::formatNPR($refund)." returned ({$league->refund_percent}% of ".Futsal::formatNPR($paid).'); '.Futsal::formatNPR($kept).' stays with the league.')
                    : '')
                .' Their unplayed fixtures are voided.',
                $hostLink
            );

            Notifier::notify(
                (int) $team->captain_id,
                'league',
                "🏳️ {$team->name} is out of {$league->name}",
                $paid > 0
                    ? ($gate['refundBlocked']
                        ? 'Nothing comes back — '.Futsal::formatNPR($paid).' was locked in once your game kicked off, per the terms you agreed to when joining 🔒'
                        : Futsal::formatNPR($refund).' of the '.Futsal::formatNPR($paid).' you paid comes back — the rest is the league’s, per the terms you agreed to when joining.')
                    : 'You’re out of the league. Nothing to refund.',
                $hostLink
            );

            return $this->ok([
                'ok' => true,
                'refund' => $refund,
                'message' => $refund > 0
                    ? 'Withdrawn — '.Futsal::formatNPR($refund)." refunded ({$league->refund_percent}% of what was paid) ↩️"
                    : ($paid > 0 && $gate['refundBlocked']
                        ? 'Withdrawn — no refund, the entry fee was locked once the game kicked off 🔒'
                        : 'Withdrawn from the league 🏳️'),
            ]);
        }

        return $this->fail('Unknown action — try request, invite, approve, reject or withdraw 🛡️', 400);
    }

    /**
     * One squad, one league, one row — re-asking reopens it instead of
     * duplicating. A squad that was declined may ask again; a withdrawn squad
     * may come back.
     */
    private function upsertEntry(int $tournamentId, int $teamId, array $values): void
    {
        $existing = TournamentTeam::where('tournament_id', $tournamentId)
            ->where('team_id', $teamId)
            ->first();

        if (! $existing) {
            TournamentTeam::create(array_merge([
                'tournament_id' => $tournamentId,
                'team_id' => $teamId,
            ], $values));

            return;
        }

        if (in_array($existing->status, League::TEAM_CLOSED_STATUSES, true)
            || $existing->status === League::TEAM_WITHDRAWN) {
            $existing->forceFill(array_merge($values, ['updated_at' => now()]))->save();
        }
    }
}
