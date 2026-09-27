<?php

namespace App\Http\Controllers\Api;

use App\Models\Team;
use App\Models\TeamInvite;
use App\Models\TeamMember;
use App\Models\TeamRequest;
use App\Models\User;
use App\Services\Notifier;
use App\Support\Teams;
use App\Support\TeamStore;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The player's side of an invitation — `GET/POST /api/team-invites`.
 */
class TeamInviteController extends ApiController
{
    /**
     * GET — every invitation waiting on this player.
     *
     * The mirror of `GET /api/teams/{id}/requests`: that one is the captain's
     * queue, this one is the player's. Only the invitee's own rows are ever
     * returned, and `quota` is how many more squads they may ask to join today.
     */
    public function index(Request $request): JsonResponse
    {
        $userId = (int) $request->query('userId', 0);

        if ($userId <= 0) {
            return $this->fail('Login to see your invites 🔒', 400, ['invites' => []]);
        }

        $raw = $request->query('status');
        $status = ($raw === 'all' || $raw === '') ? '' : ($raw ?? Teams::REQUEST_PENDING);

        return $this->ok([
            'invites' => TeamStore::playerInvites($userId, (string) $status),
            'quota' => TeamStore::joinRequestQuota($userId),
        ]);
    }

    /**
     * POST — answer an invitation.
     *
     * The invited player is the only one who can act, and the roster row is
     * created here — never when the captain sent the invite. Consent is what
     * turns an invitation into a membership.
     */
    public function store(Request $request): JsonResponse
    {
        $userId = (int) $request->input('userId', 0);
        $inviteId = (int) $request->input('inviteId', 0);
        $action = (string) $request->input('action', '');

        if ($userId <= 0) {
            return $this->fail('Login to answer invites 🔒', 400);
        }

        if ($inviteId <= 0) {
            return $this->fail('Invalid invite 📨', 400);
        }

        if ($action !== 'accept' && $action !== 'decline') {
            return $this->fail('Accept or decline the invite 📨', 400);
        }

        $invite = TeamStore::findInvite($inviteId);

        // Theirs or nobody's — an invite addressed to someone else is not a 403
        // with extra detail, it just does not exist as far as this account is
        // concerned.
        if (! $invite || (int) $invite->user_id !== $userId) {
            return $this->fail('That invite no longer exists 📨', 404);
        }

        if ($invite->status !== Teams::REQUEST_PENDING) {
            $already = $invite->status === Teams::REQUEST_ACCEPTED ? 'joined' : 'answered';

            return $this->fail("You already {$already} that invite ⏳", 409);
        }

        $team = Team::find((int) $invite->team_id);
        $player = User::find($userId);

        if (! $team) {
            // The squad went away while the invite was pending; settle the row so
            // the list stops offering an answer that can never be acted on.
            $invite->forceFill([
                'status' => Teams::REQUEST_CANCELLED,
                'decided_at' => now(),
                'decided_by' => $userId,
            ])->save();

            return $this->fail('That squad no longer exists 🛡️', 404, ['reason' => 'team_gone']);
        }

        if ($action === 'decline') {
            $invite->forceFill([
                'status' => Teams::REQUEST_DECLINED,
                'decided_at' => now(),
                'decided_by' => $userId,
            ])->save();

            Notifier::notify(
                (int) $invite->invited_by,
                'team',
                '📨 '.($player->name ?? 'A player').' declined your invite',
                ($player->name ?? 'They')." said no thanks to {$team->name}. No harm done — you can invite someone else, or wait for a request to come to you.",
                "/teams/{$team->id}"
            );

            return $this->ok([
                'ok' => true,
                'action' => $action,
                'declined' => true,
                'message' => "You declined the invite from {$team->name}",
            ]);
        }

        // Accepting is where the real checks belong, at the moment of the answer.
        if (TeamStore::isMember((int) $team->id, $userId)) {
            $invite->forceFill([
                'status' => Teams::REQUEST_ACCEPTED,
                'decided_at' => now(),
                'decided_by' => $userId,
            ])->save();

            return $this->ok([
                'ok' => true,
                'action' => $action,
                'alreadyMember' => true,
                'memberAdded' => false,
                'message' => "You’re already in {$team->name} 🛡️",
            ]);
        }

        $roster = TeamStore::teamRoster((int) $team->id);

        if (count($roster) >= (int) $team->max_players) {
            return $this->fail(
                "{$team->name} is full (".count($roster).'/'.$team->max_players.') — ask the captain to raise the team size, then accept again 👥',
                409,
                ['reason' => 'squad_full']
            );
        }

        TeamMember::create([
            'team_id' => $team->id,
            'user_id' => $userId,
            'role' => 'player',
            'joined_at' => now(),
        ]);

        $invite->forceFill([
            'status' => Teams::REQUEST_ACCEPTED,
            'decided_at' => now(),
            'decided_by' => $userId,
        ])->save();

        // An accepted invite settles any join request they had filed for the same
        // squad, so the captain is never asked to approve the same player twice.
        TeamRequest::where('team_id', $team->id)
            ->where('user_id', $userId)
            ->where('status', Teams::REQUEST_PENDING)
            ->delete();

        Notifier::notify(
            (int) $invite->invited_by,
            'team',
            '🎉 '.($player->name ?? 'A player')." said yes to {$team->name}",
            ($player->name ?? 'They').' accepted your invite and is on the roster — '.(count($roster) + 1)
            ."/{$team->max_players} in the squad now. Pick them as your team when you book a court ⚽",
            "/teams/{$team->id}"
        );

        Notifier::notify(
            $userId,
            'team',
            "🛡️ You’re in {$team->name}!",
            'You accepted the invitation from '.$team->name.' ('.($team->team_code ?? 'no code')
            .'). Choose them under "Just our gang" next time you book a court ⚽',
            "/teams/{$team->id}"
        );

        return $this->ok([
            'ok' => true,
            'action' => $action,
            'memberAdded' => true,
            'roster' => TeamStore::teamRoster((int) $team->id),
            'message' => "You’re in {$team->name} 🎉",
        ]);
    }
}
