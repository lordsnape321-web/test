<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\User;
use App\Support\Loyalty;
use App\Support\Teams;
use App\Support\TeamStore;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/players/{id} — the public dossier of one player.
 *
 * Built for the decision a captain actually has to make: a join request or an
 * invitation is one line of text in a panel, so this gathers what is otherwise
 * scattered across four screens — who they play as, how reliable they are with a
 * booked court, which squads they are already in, and what they ask of other
 * captains.
 *
 * Deliberately narrow on purpose:
 *   • no email, no phone, no booking details — this endpoint is readable by any
 *     signed-in account, so it returns only what a player volunteers to the
 *     community (their profile, their teams, their reviews).
 *   • the request/invite history is filtered to the *viewer's own* squads. What
 *     someone asked another captain is none of anybody else's business.
 */
class PlayerController extends ApiController
{
    public function show(Request $request, int $id): JsonResponse
    {
        $userId = $id;
        $viewerId = (int) $request->query('viewerId', 0);
        $hasViewer = $viewerId > 0;

        $found = User::find($userId);

        if (! $found) {
            return $this->fail('No such player 👤', 404);
        }

        // Reliability is derived the same way the player's own profile computes
        // it, so a captain and an applicant are never looking at different
        // numbers.
        $history = Booking::where('user_id', $userId)->get(['status', 'created_at'])->toArray();
        $stats = Loyalty::playerRating($history, now(), (int) ($found->trust_score ?? Loyalty::TRUST_START));

        $teams = TeamStore::teamsForUser($userId);
        $requests = TeamStore::joinRequestsFromUser($userId);
        $invites = TeamStore::playerInvites($userId, '');
        $reviews = TeamStore::playerReviews($userId);
        $matches = TeamStore::playerMatchActivity($userId);

        $myQueue = [];
        $captainOptions = [];

        if ($hasViewer && $viewerId !== $userId) {
            $myTeams = TeamStore::teamsForUser($viewerId);
            $ledIds = collect($myTeams)->filter(fn ($t) => $t['role'] === 'captain')->pluck('id')->all();

            foreach ($ledIds as $teamId) {
                // Double-check on the row itself: `teamsForUser` derives the role
                // from `teams.captain_id`, and this is the one place where
                // guessing wrong would hand a stranger another captain's inbox.
                if (! TeamStore::isCaptain((int) $teamId, $viewerId)) {
                    continue;
                }

                $led = collect($myTeams)->firstWhere('id', $teamId);

                if (! $led) {
                    continue;
                }

                $teamRequestsForMe = array_values(array_filter($requests, fn ($r) => (int) $r['teamId'] === (int) $teamId));
                $teamInvitesForMe = array_values(array_filter($invites, fn ($i) => (int) $i['teamId'] === (int) $teamId));

                $roster = TeamStore::teamRoster((int) $teamId);
                $quota = TeamStore::teamInviteQuota((int) $teamId);

                $pendingRequest = collect($teamRequestsForMe)->firstWhere('status', Teams::REQUEST_PENDING);
                $pendingInvite = collect($teamInvitesForMe)->firstWhere('status', Teams::REQUEST_PENDING);

                $captainOptions[] = [
                    'teamId' => $teamId,
                    'name' => $led['name'],
                    'teamCode' => $led['teamCode'],
                    'logoColor' => $led['logoColor'],
                    'level' => $led['level'],
                    'memberCount' => count($roster),
                    'maxPlayers' => $led['maxPlayers'],
                    'squadFull' => count($roster) >= $led['maxPlayers'],
                    'invitesLeftToday' => $quota['left'],
                    'isMember' => collect($roster)->contains(fn ($m) => (int) $m['userId'] === $userId),
                    'hasPendingRequest' => (bool) $pendingRequest,
                    'hasPendingInvite' => (bool) $pendingInvite,
                ];

                foreach ($teamRequestsForMe as $r) {
                    $myQueue[] = $this->queueRow('request', $r, $teamId, $led);
                }

                foreach ($teamInvitesForMe as $i) {
                    $myQueue[] = $this->queueRow('invite', $i, $teamId, $led);
                }
            }

            usort($myQueue, fn ($a, $b) => ($b['createdAt']?->getTimestamp() ?? 0) <=> ($a['createdAt']?->getTimestamp() ?? 0));
        }

        return $this->ok([
            'player' => [
                'id' => $found->id,
                'name' => $found->name,
                'avatarColor' => $found->avatar_color,
                'avatarUrl' => $found->avatar_url,
                'role' => $found->role,
                'level' => $found->level,
                'position' => $found->position,
                'defaultCity' => $found->default_city,
                'matchesPlayed' => $found->matches_played,
                'trustScore' => $found->trust_score,
                'memberSince' => $found->created_at,
            ],
            // Whether this account could ever be added to a squad at all: owners
            // and staff are not recruitable, and the page says so instead of
            // offering a button that would only fail.
            'invitable' => Teams::canBeInvitedToTeam($found->role),
            // `playerRating` also derives booking-only fields (payment method,
            // deposit rules) that a public dossier has no business showing, so
            // the reliability numbers are copied out and the rest is dropped.
            'stats' => [
                'completed' => $stats['completed'],
                'cancelled' => $stats['cancelled'],
                'confirmed' => $stats['confirmed'],
                'pending' => $stats['pending'],
                'total' => $stats['total'],
                'rating' => $stats['rating'],
                'label' => $stats['label'],
                'emoji' => $stats['emoji'],
                'cancelsThisMonth' => $stats['cancelsThisMonth'],
                'blocked' => $stats['blocked'],
                'trustScore' => $stats['trustScore'],
                'trustLabel' => $stats['trustLabel'],
                'trustEmoji' => $stats['trustEmoji'],
                'depositRequired' => $stats['depositRequired'],
                'depositReason' => $stats['depositReason'],
            ],
            'teams' => $teams,
            'reviews' => $reviews,
            'matches' => $matches,
            'myQueue' => $myQueue,
            'captainOptions' => $captainOptions,
            'viewer' => $hasViewer ? [
                'id' => $viewerId,
                'isSelf' => $viewerId === $userId,
                // True when there is something for this viewer to decide, which
                // is what turns the "Answer" card on or off.
                'hasSomethingToDecide' => collect($myQueue)->contains(fn ($q) => $q['status'] === Teams::REQUEST_PENDING),
                'leadsAnyTeam' => $captainOptions !== [],
            ] : null,
        ]);
    }

    /**
     * @param  array<string, mixed>  $row
     * @param  array<string, mixed>  $led
     * @return array<string, mixed>
     */
    private function queueRow(string $kind, array $row, mixed $teamId, array $led): array
    {
        return [
            'kind' => $kind,
            'id' => $row['id'],
            'teamId' => $teamId,
            'teamName' => $led['name'],
            'teamCode' => $led['teamCode'],
            'logoColor' => $led['logoColor'],
            'message' => $row['message'],
            'status' => $row['status'],
            'createdAt' => $row['createdAt'] ?? null,
            'decidedAt' => $row['decidedAt'] ?? null,
        ];
    }
}
