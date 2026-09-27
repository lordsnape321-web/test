<?php

namespace App\Http\Controllers\Api;

use App\Models\Team;
use App\Models\TeamInvite;
use App\Models\TeamMember;
use App\Models\TeamRequest;
use App\Models\User;
use App\Models\Venue;
use App\Services\Notifier;
use App\Support\League;
use App\Support\LeagueStore;
use App\Support\TeamStore;
use App\Support\Teams;
use App\Support\Validation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Squads 🛡️
 *
 * Joining a squad is a two-sided agreement in this app: a player *asks* to join,
 * the captain *answers*, and a captain *invites* rather than adding. A roster row
 * is only ever written by the answer, never by the ask — that is what makes
 * "the captain manages the team" real rather than cosmetic.
 */
class TeamController extends ApiController
{
    private const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

    /* ------------------------------------------------------------- /teams */

    /**
     * GET /api/teams
     *
     * `?userId=` returns just that player's squads — the shape the booking
     * flow's team picker needs — while `?q=`/`?code=` searches for a squad by
     * name or unique code.
     */
    public function index(Request $request): JsonResponse
    {
        $userId = (int) $request->query('userId', 0);

        if ($userId > 0) {
            return $this->ok(['teams' => TeamStore::teamsForUser($userId)]);
        }

        $q = trim((string) ($request->query('q') ?? $request->query('code') ?? ''));
        $viewerId = (int) $request->query('viewerId', 0);
        $hasViewer = $viewerId > 0;

        $base = collect($q !== '' ? TeamStore::searchTeams($q, 50) : Team::all()->map(fn ($t) => $t->toArray())->all());
        $teamIds = $base->pluck('id')->map(fn ($v) => (int) $v)->all();

        $members = TeamMember::all();
        $userIds = $members->pluck('user_id')->merge($base->pluck('captain_id'))->filter()->unique()->all();
        $users = $userIds === [] ? collect() : User::whereIn('id', $userIds)->get()->keyBy('id');

        $pending = TeamStore::pendingRequestCounts($teamIds);
        $pendingInvites = TeamStore::pendingInviteCounts($teamIds);

        // Invite slots are per squad, so they are looked up only for the squads
        // this viewer actually captains — a player browsing sees no numbers.
        $captainedIds = $base->filter(fn ($t) => (int) ($t['captainId'] ?? 0) === $viewerId)
            ->pluck('id')->map(fn ($v) => (int) $v)->all();

        $inviteQuotas = [];

        foreach ($captainedIds as $id) {
            $inviteQuotas[$id] = TeamStore::teamInviteQuota($id);
        }

        $viewerQuota = $hasViewer ? TeamStore::joinRequestQuota($viewerId) : null;

        $enriched = $base->map(function ($t) use ($members, $users, $pending, $pendingInvites, $inviteQuotas, $viewerId, $hasViewer) {
            $teamId = (int) ($t['id'] ?? 0);
            $tm = $members->filter(fn ($m) => (int) $m->team_id === $teamId);
            $players = $tm->map(fn ($m) => $users->get((int) $m->user_id))->filter()->values()->all();
            $captain = $users->get((int) ($t['captainId'] ?? 0));
            $mine = $tm->contains(fn ($m) => (int) $m->user_id === $viewerId);
            $leads = (int) ($t['captainId'] ?? 0) === $viewerId;

            // An open invitation outranks a request: it is the squad asking the
            // player, and the card's buttons change from "ask" to "say yes".
            $request = ($hasViewer && ! $mine) ? TeamStore::myPendingRequest($teamId, $viewerId) : null;
            $invite = ($hasViewer && ! $mine) ? TeamStore::myPendingInvite($teamId, $viewerId) : null;

            return array_merge($t, [
                'teamCode' => $t['teamCode'] ?? '',
                'memberCount' => $tm->count(),
                'players' => $players,
                'captainName' => $captain->name ?? '—',
                // Only the captain needs to see how many requests are waiting…
                'pendingRequests' => $leads ? ($pending[$teamId] ?? 0) : 0,
                // …and how many invitations they have out with no answer yet.
                'pendingInvites' => $leads ? ($pendingInvites[$teamId] ?? 0) : 0,
                'invitesLeftToday' => $leads ? ($inviteQuotas[$teamId]['left'] ?? 0) : 0,
                'viewer' => $hasViewer ? [
                    'isMember' => $mine,
                    'isCaptain' => $leads,
                    'requestStatus' => $request?->status ?? null,
                    'requestId' => $request?->id ?? null,
                    'inviteStatus' => $invite?->status ?? null,
                    'inviteId' => $invite?->id ?? null,
                ] : null,
            ]);
        })->values()->all();

        return $this->ok([
            'teams' => $enriched,
            'query' => $q,
            // The player's side of the daily cap, so /teams can warn before the
            // fifth tap rather than after it.
            'quota' => $viewerQuota,
        ]);
    }

    /** POST /api/teams — start a squad. The founder is its one captain. */
    public function store(Request $request): JsonResponse
    {
        $name = trim((string) $request->input('name', ''));
        $motto = trim((string) $request->input('motto', ''));
        $description = trim((string) $request->input('description', ''));
        $captainId = (int) $request->input('captainId', 0);
        $homeVenueId = (int) $request->input('homeVenueId', 0) ?: 0;

        $error = Validation::firstError(
            Validation::title($name, ['min' => 3, 'max' => 50, 'label' => 'Team name']),
            $motto !== '' ? Validation::message($motto, ['min' => 3, 'max' => 120, 'label' => 'Motto', 'required' => false]) : null,
            Validation::teamDescription($description),
            // Blank is allowed: the create form promises "leave it blank and
            // we'll generate one", so the code is derived from the name below
            // instead of the request bouncing with a 400.
            ! $request->has('teamCode') || trim((string) $request->input('teamCode')) === ''
                ? null
                : Validation::teamCode($request->input('teamCode')),
            $captainId <= 0 ? 'Login to start a team 🔒' : null,
            $request->filled('level') && ! in_array((string) $request->input('level'), self::LEVELS, true)
                ? 'Pick a valid level 🌱⚡🔥' : null,
        );

        if ($error) {
            return $this->fail($error, 400);
        }

        $maxPlayers = (int) $request->input('maxPlayers', 12);

        if ($maxPlayers < 4 || $maxPlayers > 30) {
            return $this->fail('Team size must be 4–30 players 👥', 400);
        }

        $captain = User::find($captainId);

        if (! $captain) {
            return $this->fail('Login to start a team 🔒', 400);
        }

        $teamCode = Teams::normalizeCode($request->input('teamCode'));

        if ($teamCode !== '' && TeamStore::teamCodeTaken($teamCode)) {
            return $this->fail(
                "Code \"{$teamCode}\" is already taken — try another so your squad is easy to find 🛡️",
                409,
                ['codeError' => 'taken']
            );
        }

        if ($teamCode === '') {
            // `suggestCode` appends random characters, so a few retries settle
            // any collision with a squad that drew the same tail.
            for ($i = 0; $i < 8 && $teamCode === ''; $i++) {
                $guess = Teams::suggestCode($name);

                if (! TeamStore::teamCodeTaken($guess)) {
                    $teamCode = $guess;
                }
            }

            if ($teamCode === '') {
                return $this->fail('Every code we tried for that name is taken — type your own 🛡️', 409, ['codeError' => 'taken']);
            }
        }

        $venueId = null;
        $homeGround = '';

        if ($homeVenueId > 0) {
            $venue = Venue::find($homeVenueId);

            if (! $venue) {
                return $this->fail('Pick a home turf from the venues on this platform 📍', 400);
            }

            // Snapshot the name so the card keeps rendering if the venue changes.
            $venueId = $venue->id;
            $homeGround = $venue->name;
        }

        $team = Team::create([
            'name' => $name,
            'motto' => $motto,
            'description' => $description,
            'team_code' => $teamCode,
            'captain_id' => $captainId,
            'max_players' => $maxPlayers,
            'level' => $request->input('level') ?? 'Intermediate',
            'logo_color' => $request->input('logoColor') ?? '#16a34a',
            'home_venue_id' => $venueId,
            'home_ground' => $homeGround,
            'looking_for_players' => $request->boolean('lookingForPlayers', true),
        ]);

        // One membership row, one captain: the founder. Nothing in the API can
        // create a second one.
        TeamMember::create([
            'team_id' => $team->id,
            'user_id' => $captainId,
            'role' => 'captain',
            'joined_at' => now(),
        ]);

        return $this->ok(['team' => $team->toArray()], 201);
    }

    /**
     * GET /api/teams/{id}
     *
     * The list answers "which squads match?"; this one answers "tell me about
     * this squad" — the description, the record, the whole roster, and the
     * viewer's own relationship to it so the buttons are honest. The
     * captain-only extras are attached only when `viewerId` really is the
     * captain, checked server-side.
     */
    public function show(Request $request, int $id): JsonResponse
    {
        $team = Team::find($id);

        if (! $team) {
            return $this->fail('Team not found 🛡️', 404);
        }

        $viewerId = (int) $request->query('viewerId', 0);
        $hasViewer = $viewerId > 0;
        $leads = $hasViewer && TeamStore::isCaptain((int) $id, $viewerId);
        $mine = $hasViewer && TeamStore::isMember((int) $id, $viewerId);

        $roster = TeamStore::teamRoster((int) $id);
        $captain = User::find($team->captain_id);

        // An open invitation outranks a request when deciding what the viewer sees.
        $request = ($hasViewer && ! $mine) ? TeamStore::myPendingRequest((int) $id, $viewerId) : null;
        $invite = ($hasViewer && ! $mine) ? TeamStore::myPendingInvite((int) $id, $viewerId) : null;

        $played = (int) $team->wins + (int) $team->losses + (int) $team->draws;

        $body = [
            'team' => $team->toArray() + [
                'teamCode' => $team->team_code ?? '',
                'memberCount' => count($roster),
                'captainName' => $captain->name ?? '—',
                'winRate' => $played > 0 ? (int) round(((int) $team->wins / $played) * 100) : 0,
                'gamesPlayed' => $played,
            ],
            // Contact details stay with the captain, as on the panel.
            'roster' => $leads ? $roster : array_map(fn ($m) => $m + ['email' => ''], $roster),
            // League & competition record 🏆 — public on purpose: a record a
            // squad earned is part of who they are.
            'competition' => LeagueStore::teamCompetitionProfile((int) $id),
            'viewer' => $hasViewer ? [
                'isMember' => $mine,
                'isCaptain' => $leads,
                'requestStatus' => $request?->status ?? null,
                'requestId' => $request?->id ?? null,
                'inviteStatus' => $invite?->status ?? null,
                'inviteId' => $invite?->id ?? null,
            ] : null,
        ];

        if ($leads) {
            $body['captain'] = [
                'pendingRequests' => TeamStore::teamJoinRequests((int) $id),
                'requestHistory' => array_slice(
                    array_values(array_filter(
                        TeamStore::teamJoinRequests((int) $id, ''),
                        fn ($r) => $r['status'] !== Teams::REQUEST_PENDING
                    )),
                    -8
                ),
                'invites' => TeamStore::teamSentInvites((int) $id, ''),
                'quota' => TeamStore::teamInviteQuota((int) $id),
            ];
        }

        return $this->ok($body);
    }

    /**
     * PATCH /api/teams/{id} — the captain edits their squad.
     *
     * Every field is optional; only what is sent changes. `newCaptainId` hands
     * the armband to another member, which is the only way captaincy moves — and
     * the only way a captain can later step away, since a team must always have
     * exactly one.
     */
    public function update(Request $request, int $id): JsonResponse
    {
        $actorId = (int) $request->input('captainId', 0);

        if (! TeamStore::isCaptain($id, $actorId)) {
            return $this->fail('Only the captain can edit this team 👑', 403);
        }

        $team = Team::find($id);

        if (! $team) {
            return $this->fail('Team not found 🛡️', 404);
        }

        $patch = [];

        if ($request->has('name')) {
            $name = trim((string) $request->input('name'));
            $error = Validation::title($name, ['min' => 3, 'max' => 50, 'label' => 'Team name']);

            if ($error) {
                return $this->fail($error, 400);
            }

            $patch['name'] = $name;
        }

        if ($request->has('motto')) {
            $motto = trim((string) $request->input('motto'));
            $error = Validation::message($motto, ['min' => 3, 'max' => 120, 'label' => 'Motto', 'required' => false]);

            if ($error) {
                return $this->fail($error, 400);
            }

            $patch['motto'] = $motto;
        }

        if ($request->has('description')) {
            // "About us" is optional, but never blank-by-accident: an
            // all-whitespace edit clears the description, which is a legitimate
            // thing to want.
            $description = trim((string) $request->input('description'));
            $error = Validation::teamDescription($description);

            if ($error) {
                return $this->fail($error, 400);
            }

            $patch['description'] = $description;
        }

        if ($request->has('level')) {
            if (! in_array((string) $request->input('level'), self::LEVELS, true)) {
                return $this->fail('Pick a valid level 🌱⚡🔥', 400);
            }

            $patch['level'] = (string) $request->input('level');
        }

        if ($request->has('logoColor')) {
            $colour = trim((string) $request->input('logoColor'));

            if (preg_match('/^#[0-9a-fA-F]{6}$/', $colour) !== 1) {
                return $this->fail('Pick a valid colour 🎨', 400);
            }

            $patch['logo_color'] = $colour;
        }

        if ($request->has('lookingForPlayers')) {
            $patch['looking_for_players'] = $request->boolean('lookingForPlayers');
        }

        if ($request->has('maxPlayers')) {
            $maxPlayers = (int) $request->input('maxPlayers');

            if ($maxPlayers < 4 || $maxPlayers > 30) {
                return $this->fail('Team size must be 4–30 players 👥', 400);
            }

            $rosterSize = count(TeamStore::teamRoster($id));

            if ($maxPlayers < $rosterSize) {
                return $this->fail("You already have {$rosterSize} members — the limit can’t be lower than that 👥", 400);
            }

            $patch['max_players'] = $maxPlayers;
        }

        // Home turf is picked from venues on the platform, never typed free-hand.
        if ($request->has('homeVenueId')) {
            $homeVenueId = (int) $request->input('homeVenueId', 0) ?: 0;

            if ($homeVenueId === 0) {
                $patch['home_venue_id'] = null;
                $patch['home_ground'] = '';
            } else {
                $venue = Venue::find($homeVenueId);

                if (! $venue) {
                    return $this->fail('Pick a home turf from the venues on this platform 📍', 400);
                }

                $patch['home_venue_id'] = $venue->id;
                $patch['home_ground'] = $venue->name;
            }
        }

        if ($request->has('teamCode')) {
            $error = Validation::teamCode($request->input('teamCode'));

            if ($error) {
                return $this->fail($error, 400);
            }

            $teamCode = Teams::normalizeCode($request->input('teamCode'));

            if ($teamCode !== Teams::normalizeCode($team->team_code ?? '')) {
                if (TeamStore::teamCodeTaken($teamCode, $id)) {
                    return $this->fail("Code \"{$teamCode}\" is already taken — try another 🛡️", 409, ['codeError' => 'taken']);
                }

                $patch['team_code'] = $teamCode;
            }
        }

        $newCaptainId = (int) $request->input('newCaptainId', 0);

        if ($newCaptainId > 0 && $newCaptainId !== (int) $team->captain_id) {
            // Must already be on the roster — you can't hand a team to a stranger.
            $target = User::find($newCaptainId);

            if (! $target) {
                return $this->fail('That player doesn’t exist 🔒', 400);
            }

            $transferred = TeamStore::transferCaptaincy($id, $newCaptainId);

            if (! $transferred) {
                return $this->fail(
                    "{$target->name} isn’t a member of your squad — add them first, then hand over the armband 👑",
                    400,
                    ['reason' => 'not_a_member']
                );
            }

            Notifier::notify(
                $newCaptainId,
                'team',
                "👑 You captain {$transferred->name} now",
                "You took over as captain of {$transferred->name} (".($transferred->team_code ?? 'no code')
                .'). You can accept join requests, add or remove members, and edit the team details.',
                '/teams'
            );

            Notifier::notify(
                $actorId,
                'team',
                '🛡️ Armband handed over',
                "{$target->name} is the new captain of {$transferred->name}. You’re still a member — you can now step away from the team if you want.",
                '/teams'
            );
        }

        if ($patch === [] && $newCaptainId <= 0) {
            return $this->fail('Nothing to update 🛡️', 400);
        }

        if ($patch !== []) {
            $team->forceFill($patch)->save();
        }

        return $this->ok([
            'team' => $team->fresh()->toArray(),
            'roster' => TeamStore::teamRoster($id),
        ]);
    }

    /* ------------------------------------------------- /teams/{id}/join */

    /**
     * POST /api/teams/{id}/join — ask to join.
     *
     * Joining is not instant: this files a request the captain accepts or
     * declines, which is what makes the roster something only the captain
     * changes. The daily cap is the other half of the deal — plenty to find a
     * team, and enough to stop a bot carpet-bombing every captain.
     */
    public function join(Request $request, int $id): JsonResponse
    {
        $userId = (int) $request->input('userId', 0);

        if ($userId <= 0) {
            return $this->fail('Login to join a team 🔒', 400);
        }

        $message = trim((string) $request->input('message', ''));
        $error = Validation::joinMessage($message);

        if ($error) {
            return $this->fail($error, 400);
        }

        $team = Team::find($id);

        if (! $team) {
            return $this->fail('Team not found 🛡️', 404);
        }

        if (TeamStore::isMember($id, $userId)) {
            return $this->ok(['ok' => true, 'alreadyMember' => true, 'message' => 'You’re already in this squad 🛡️']);
        }

        $roster = TeamStore::teamRoster($id);

        if (count($roster) >= (int) $team->max_players) {
            return $this->fail(
                'This squad is full ('.count($roster).'/'.$team->max_players.') — the captain would need to raise the limit first 👥',
                409
            );
        }

        if (TeamStore::myPendingRequest($id, $userId)) {
            return $this->fail('You’ve already asked to join — the captain hasn’t decided yet ⏳', 409);
        }

        // An invitation from this very squad is a better offer than a request:
        // the captain already wants them, so the answer belongs in the invite,
        // not in a second queue the captain then has to reconcile.
        $invite = TeamStore::myPendingInvite($id, $userId);

        if ($invite) {
            return $this->fail(
                "{$team->name} already invited you — accept the invite instead of asking 🎉",
                409,
                ['reason' => 'invited', 'inviteId' => $invite->id]
            );
        }

        $quota = TeamStore::joinRequestQuota($userId);

        if (Teams::quotaExhausted($quota)) {
            return $this->fail(
                "That’s {$quota['used']} join requests today — players can ask {$quota['limit']} squads a day. "
                .'Your pending asks are still with their captains, and the count resets after midnight 🌙',
                429,
                ['reason' => 'daily_limit', 'quota' => $quota, 'resetsAt' => Teams::quotaResetsAt()]
            );
        }

        // A declined or withdrawn ask may be made again; the row is reused so a
        // player's history with the squad stays one row.
        $reopen = TeamRequest::where('team_id', $id)
            ->where('user_id', $userId)
            ->get()
            ->first(fn (TeamRequest $r) => in_array($r->status, Teams::REOPENABLE_REQUEST_STATUSES, true));

        if ($reopen) {
            $reopen->forceFill([
                'status' => Teams::REQUEST_PENDING,
                'message' => $message,
                'created_at' => now(),
                'decided_at' => null,
                'decided_by' => null,
            ])->save();
        } else {
            TeamRequest::create([
                'team_id' => $id,
                'user_id' => $userId,
                'message' => $message,
                'status' => Teams::REQUEST_PENDING,
            ]);
        }

        $requester = User::find($userId);

        if ($team->captain_id && (int) $team->captain_id !== $userId) {
            Notifier::notify(
                (int) $team->captain_id,
                'team',
                "🛡️ ".($requester->name ?? 'A player')." asked to join {$team->name}",
                ($requester->name ?? 'A player').' ('.($requester->level ?? '—').' • '.($requester->position ?? '—')
                .') wants to join'.($message !== '' ? " — \"{$message}\"" : '')
                .'. Open their profile to see their record, reliability and other squads before you answer.',
                // Straight to the player's dossier — everything about the person
                // asking, with Accept/Decline on the same page.
                "/players/{$userId}"
            );
        }

        return $this->ok([
            'ok' => true,
            'status' => Teams::REQUEST_PENDING,
            'message' => "Request sent — {$team->name}’s captain will review it 🛡️",
            // So the page can update "2 of 5 asks left today" without another fetch.
            'quota' => array_merge($quota, ['used' => $quota['used'] + 1, 'left' => max(0, $quota['left'] - 1)]),
        ], 201);
    }

    /**
     * DELETE /api/teams/{id}/join — leave the squad, or withdraw a request.
     *
     * A captain cannot leave: a team always has exactly one captain, so they
     * must hand the armband to another member first.
     */
    public function leave(Request $request, int $id): JsonResponse
    {
        $userId = (int) $request->query('userId', 0);

        if ($userId <= 0) {
            return $this->fail('Login required 🔒', 400);
        }

        $team = Team::find($id);

        if (! $team) {
            return $this->fail('Team not found 🛡️', 404);
        }

        if (TeamStore::isMember($id, $userId)) {
            if (TeamStore::isCaptain($id, $userId)) {
                $others = collect(TeamStore::teamRoster($id))->filter(fn ($m) => (int) $m['userId'] !== $userId)->all();

                return $this->fail(
                    $others !== []
                        ? "You’re the captain of {$team->name} 👑 — hand the armband to another member first, then you can step away. A team always has exactly one captain."
                        : "You’re the captain and only member of {$team->name} 👑 — a team always has exactly one captain, so there’s nobody to hand it to yet.",
                    409,
                    ['reason' => 'captain_must_transfer']
                );
            }

            TeamMember::where('team_id', $id)->where('user_id', $userId)->delete();

            // Clear any stale requests too, so re-joining later starts clean.
            TeamRequest::where('team_id', $id)->where('user_id', $userId)->where('status', Teams::REQUEST_PENDING)->delete();

            return $this->ok(['ok' => true, 'left' => true]);
        }

        $pending = TeamStore::myPendingRequest($id, $userId);

        if ($pending) {
            $pending->forceFill([
                'status' => Teams::REQUEST_CANCELLED,
                'decided_at' => now(),
                'decided_by' => $userId,
            ])->save();

            return $this->ok(['ok' => true, 'cancelled' => true]);
        }

        return $this->fail('You’re not in this team and have no pending request 🛡️', 404);
    }

    /* ------------------------------------------- /teams/{id}/members */

    /**
     * GET /api/teams/{id}/members
     *
     * Public, so anyone can see who plays for a squad — but members' email
     * addresses only go to the captain (`?captainId=`, verified server-side).
     */
    public function members(Request $request, int $id): JsonResponse
    {
        $team = Team::find($id);

        if (! $team) {
            return $this->fail('Team not found 🛡️', 404);
        }

        $viewerId = (int) $request->query('viewerId', 0);
        $forCaptain = $viewerId > 0 && TeamStore::isCaptain($id, $viewerId);
        $roster = TeamStore::teamRoster($id);

        return $this->ok([
            'roster' => $forCaptain ? $roster : array_map(fn ($m) => $m + ['email' => ''], $roster),
            'team' => [
                'id' => $team->id,
                'name' => $team->name,
                'teamCode' => $team->team_code ?? '',
                'captainId' => $team->captain_id,
                'maxPlayers' => $team->max_players,
                'memberCount' => count($roster),
            ],
        ]);
    }

    /**
     * POST /api/teams/{id}/members — no longer a way in.
     *
     * This used to write a roster row straight away, which meant a squad could
     * gain members who never agreed to be in it. Consent is now the rule on
     * both sides, so the captain's side of the deal is an invitation. The
     * endpoint stays and says so, because a stale client should learn the new
     * route instead of silently getting a 404 — and so nothing can ever
     * re-introduce a direct add by accident.
     */
    public function addMember(int $id): JsonResponse
    {
        return response()->json([
            'error' => 'Captains can’t add players without their say-so anymore 🛡️ Send an invite instead — the player accepts or declines it.',
            'reason' => 'consent_required',
            'use' => "/api/teams/{$id}/invites",
        ], 405, ['Allow' => 'GET, DELETE']);
    }

    /**
     * DELETE /api/teams/{id}/members — the captain removes a member.
     *
     * The captain cannot remove themselves: a team always has exactly one
     * captain, so they transfer the armband first.
     */
    public function removeMember(Request $request, int $id): JsonResponse
    {
        $captainId = (int) $request->query('captainId', 0);
        $userId = (int) $request->query('userId', 0);

        if ($userId <= 0) {
            return $this->fail('Pick a player to remove 👥', 400);
        }

        if (! TeamStore::isCaptain($id, $captainId)) {
            return $this->fail('Only the captain can remove members 👑', 403);
        }

        if ($userId === $captainId) {
            return $this->fail(
                'You can’t remove yourself while you’re captain 👑 — hand the armband to another member first.',
                409,
                ['reason' => 'captain_cannot_self_remove']
            );
        }

        $team = Team::find($id);

        if (! $team) {
            return $this->fail('Team not found 🛡️', 404);
        }

        if (! TeamStore::isMember($id, $userId)) {
            return $this->fail('That player isn’t in your squad 🛡️', 404);
        }

        TeamMember::where('team_id', $id)->where('user_id', $userId)->delete();
        TeamRequest::where('team_id', $id)->where('user_id', $userId)->delete();

        $person = User::find($userId);

        Notifier::notify(
            $userId,
            'team',
            "🛡️ You’re no longer in {$team->name}",
            "The captain removed you from {$team->name}. If that looks like a mistake, ask them to add you back or request to join again from the Teams page.",
            '/teams'
        );

        return $this->ok([
            'ok' => true,
            'removed' => $userId,
            'removedName' => $person->name ?? '',
            'roster' => TeamStore::teamRoster($id),
        ]);
    }

    /* ------------------------------------------- /teams/{id}/invites */

    /**
     * GET /api/teams/{id}/invites — the invites this squad has sent.
     *
     * Captain-gated, like the join-request queue: a player's answer is theirs to
     * make, and nobody else gets to watch it pending. `?status=all` includes the
     * answered ones so the panel can show history.
     */
    public function invites(Request $request, int $id): JsonResponse
    {
        $captainId = (int) $request->query('captainId', 0);

        if (! TeamStore::isCaptain($id, $captainId)) {
            return $this->fail('Only the captain can see sent invites 👑', 403, ['invites' => []]);
        }

        $raw = $request->query('status');
        $status = ($raw === 'all' || $raw === '') ? '' : ($raw ?? Teams::REQUEST_PENDING);

        return $this->ok([
            'invites' => TeamStore::teamSentInvites($id, (string) $status),
            'quota' => TeamStore::teamInviteQuota($id),
        ]);
    }

    /**
     * POST /api/teams/{id}/invites — invite a player.
     *
     * Nothing lands on the roster here: an invite row is filed and the *player*
     * decides. The daily limit keeps the panel a recruiting tool rather than a
     * cold-inbox machine.
     */
    public function invite(Request $request, int $id): JsonResponse
    {
        $captainId = (int) $request->input('captainId', 0);
        $userId = (int) $request->input('userId', 0);
        $message = trim((string) $request->input('message', ''));

        if ($userId <= 0) {
            return $this->fail('Pick a player to invite 👥', 400);
        }

        $error = Validation::inviteMessage($message);

        if ($error) {
            return $this->fail($error, 400);
        }

        if (! TeamStore::isCaptain($id, $captainId)) {
            return $this->fail('Only the captain can invite players 👑', 403);
        }

        $team = Team::find($id);

        if (! $team) {
            return $this->fail('Team not found 🛡️', 404);
        }

        $person = User::find($userId);

        if (! $person) {
            return $this->fail('That player doesn’t exist 🔒', 404);
        }

        // Server-side, not just a filtered list: a squad is made of players, and
        // the owner/admin accounts on this platform have a different job.
        if (! Teams::canBeInvitedToTeam($person->role)) {
            return $this->fail(Teams::invitableRoleError($person->role, (string) $person->name), 403, ['reason' => 'not_invitable']);
        }

        if (TeamStore::isMember($id, $userId)) {
            return $this->ok([
                'ok' => true,
                'alreadyMember' => true,
                'message' => "{$person->name} is already in the squad 🛡️",
            ]);
        }

        $roster = TeamStore::teamRoster($id);

        if (count($roster) >= (int) $team->max_players) {
            return $this->fail(
                'Your squad is full ('.count($roster).'/'.$team->max_players.') — raise the team size before inviting 👥',
                409,
                ['reason' => 'squad_full']
            );
        }

        // They already asked to join: the captain should answer that, not double up.
        $asked = TeamRequest::where('team_id', $id)->where('user_id', $userId)->where('status', Teams::REQUEST_PENDING)->first();

        if ($asked) {
            return $this->fail(
                "{$person->name} already asked to join — accept or decline it in your join requests instead of inviting 🛡️",
                409,
                ['reason' => 'already_requested', 'requestId' => $asked->id]
            );
        }

        $existing = TeamStore::myPendingInvite($id, $userId);

        if ($existing) {
            return $this->ok([
                'ok' => true,
                'alreadyInvited' => true,
                'message' => "{$person->name} already has an invite waiting — give them a moment to answer ⏳",
                'quota' => TeamStore::teamInviteQuota($id),
            ]);
        }

        $quota = TeamStore::teamInviteQuota($id);

        if (Teams::quotaExhausted($quota)) {
            return $this->fail(
                "That’s {$quota['used']} invites for {$team->name} today — the limit is {$quota['limit']} a day. Try again after midnight 🌙",
                429,
                ['reason' => 'daily_limit', 'quota' => $quota, 'resetsAt' => Teams::quotaResetsAt()]
            );
        }

        $reopen = TeamStore::reopenableInvite($id, $userId);

        if ($reopen) {
            $reopen->forceFill([
                'status' => Teams::REQUEST_PENDING,
                'message' => $message,
                'invited_by' => $captainId,
                'created_at' => now(),
                'decided_at' => null,
                'decided_by' => null,
            ])->save();
        } else {
            TeamInvite::create([
                'team_id' => $id,
                'user_id' => $userId,
                'invited_by' => $captainId,
                'message' => $message,
                'status' => Teams::REQUEST_PENDING,
            ]);
        }

        Notifier::notify(
            $userId,
            'team',
            "📨 {$team->name} invited you",
            "You’re wanted in {$team->name} (".($team->team_code ?? 'no code').')'
            .($team->home_ground ? " at {$team->home_ground}" : '').'. '
            .($message !== '' ? "They wrote: \"{$message}\". " : '')
            .'Accept to join the squad, or decline — nothing changes until you answer.',
            // The squad's own page: full description, the record and every name
            // already in it, which is what makes an invitation answerable.
            "/teams/{$id}"
        );

        return $this->ok([
            'ok' => true,
            'invited' => true,
            'message' => "Invite sent to {$person->name} — they’ll decide 📨",
            'quota' => array_merge($quota, ['used' => $quota['used'] + 1, 'left' => max(0, $quota['left'] - 1)]),
        ], 201);
    }

    /**
     * DELETE /api/teams/{id}/invites — take an invitation back.
     *
     * Only a pending invite can be withdrawn, and only by the squad's captain.
     * It is recorded as cancelled rather than deleted, so the player's history
     * with the squad stays one honest row.
     */
    public function withdrawInvite(Request $request, int $id): JsonResponse
    {
        $captainId = (int) $request->query('captainId', 0);
        $inviteId = (int) $request->query('inviteId', 0);

        if ($inviteId <= 0) {
            return $this->fail('Invalid invite 📨', 400);
        }

        if (! TeamStore::isCaptain($id, $captainId)) {
            return $this->fail('Only the captain can withdraw an invite 👑', 403);
        }

        $invite = TeamStore::findInvite($inviteId);

        if (! $invite || (int) $invite->team_id !== $id) {
            return $this->fail('That invite no longer exists 📨', 404);
        }

        if ($invite->status !== Teams::REQUEST_PENDING) {
            return $this->fail("That invite was already {$invite->status} ⏳", 409);
        }

        $invite->forceFill([
            'status' => Teams::REQUEST_CANCELLED,
            'decided_at' => now(),
            'decided_by' => $captainId,
        ])->save();

        $team = Team::find($id);

        Notifier::notify(
            (int) $invite->user_id,
            'team',
            '📨 Invite from '.($team->name ?? 'a team').' was withdrawn',
            'The captain took back the invitation to '.($team->name ?? 'the squad')
            .'. If you still want in, ask to join from the Teams page.',
            $id ? "/teams/{$id}" : '/teams'
        );

        return $this->ok([
            'ok' => true,
            'cancelled' => true,
            'invites' => TeamStore::teamSentInvites($id),
            'quota' => TeamStore::teamInviteQuota($id),
        ]);
    }

    /* ------------------------------------------ /teams/{id}/requests */

    /**
     * GET /api/teams/{id}/requests — the captain's join-request queue.
     *
     * Captain-gated: nobody else sees who has asked to join. `?status=all`
     * returns the decided ones too, which is the panel's history list.
     */
    public function requests(Request $request, int $id): JsonResponse
    {
        $captainId = (int) $request->query('captainId', 0);

        if (! TeamStore::isCaptain($id, $captainId)) {
            return $this->fail('Only the captain can see join requests 👑', 403, ['requests' => []]);
        }

        $raw = $request->query('status');
        $status = ($raw === 'all' || $raw === '') ? '' : ($raw ?? Teams::REQUEST_PENDING);

        return $this->ok(['requests' => TeamStore::teamJoinRequests($id, (string) $status)]);
    }

    /**
     * POST /api/teams/{id}/requests — accept or decline one request.
     *
     * Accepting is the only way a request becomes a roster row, and it re-checks
     * the squad size at decision time rather than trusting the count from when
     * the player asked.
     */
    public function decideRequest(Request $request, int $id): JsonResponse
    {
        $captainId = (int) $request->input('captainId', 0);
        $requestId = (int) $request->input('requestId', 0);
        $action = (string) $request->input('action', '');

        if ($requestId <= 0) {
            return $this->fail('Invalid request 🛡️', 400);
        }

        if ($action !== 'accept' && $action !== 'decline') {
            return $this->fail('Choose accept or decline 🛡️', 400);
        }

        if (! TeamStore::isCaptain($id, $captainId)) {
            return $this->fail('Only the captain can decide join requests 👑', 403);
        }

        $joinRequest = TeamRequest::where('id', $requestId)->where('team_id', $id)->first();

        if (! $joinRequest) {
            return $this->fail('That request no longer exists 🛡️', 404);
        }

        if ($joinRequest->status !== Teams::REQUEST_PENDING) {
            return $this->fail("That request was already {$joinRequest->status} ⏳", 409);
        }

        $team = Team::find($id);

        if (! $team) {
            return $this->fail('Team not found 🛡️', 404);
        }

        $joinRequest->forceFill([
            'status' => $action === 'accept' ? Teams::REQUEST_ACCEPTED : Teams::REQUEST_DECLINED,
            'decided_at' => now(),
            'decided_by' => $captainId,
        ])->save();

        $decided = $joinRequest->fresh();

        if ($action === 'decline') {
            Notifier::notify(
                (int) $joinRequest->user_id,
                'team',
                "🛡️ {$team->name} couldn’t take you this time",
                "The captain declined your request to join {$team->name}. Nothing personal — squads stay small on purpose. You’re welcome to ask again later or find another team.",
                "/teams/{$team->id}"
            );

            return $this->ok(['ok' => true, 'action' => $action, 'request' => $decided->toArray(), 'memberAdded' => false]);
        }

        // Accept: they may already have been added directly by the captain.
        if (TeamStore::isMember($id, (int) $joinRequest->user_id)) {
            return $this->ok([
                'ok' => true,
                'action' => $action,
                'request' => $decided->toArray(),
                'memberAdded' => false,
                'message' => 'They were already on the roster 🛡️',
            ]);
        }

        $roster = TeamStore::teamRoster($id);

        if (count($roster) >= (int) $team->max_players) {
            return $this->fail(
                'Your squad is full ('.count($roster).'/'.$team->max_players.') — raise the team size before accepting 👥',
                409,
                ['reason' => 'squad_full']
            );
        }

        TeamMember::create([
            'team_id' => $id,
            'user_id' => (int) $joinRequest->user_id,
            'role' => 'player',
            'joined_at' => now(),
        ]);

        Notifier::notify(
            (int) $joinRequest->user_id,
            'team',
            "🎉 You’re in {$team->name}!",
            'The captain accepted your request — you’re officially part of '.$team->name
            .' ('.($team->team_code ?? 'no code').'). Pick "Just our gang" and choose them when you book a court 🛡️',
            "/teams/{$team->id}"
        );

        return $this->ok(['ok' => true, 'action' => $action, 'request' => $decided->toArray(), 'memberAdded' => true]);
    }
}
