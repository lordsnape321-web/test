<?php

namespace App\Http\Controllers\Api;

use App\Models\Tournament;
use App\Models\TournamentMatch;
use App\Models\TournamentMedia;
use App\Models\User;
use App\Services\Notifier;
use App\Support\LeagueStore;
use App\Support\Validation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The league album 📸 — `/api/tournaments/{id}/media`.
 */
class TournamentMediaController extends ApiController
{
    /** ~2MB data URL, the same ceiling as receipts. */
    private const MAX_MEDIA_CHARS = 2000000;

    /**
     * GET — the album.
     *
     * Photos are the most private thing in a league, so the guest list is
     * explicit:
     *
     * - the **host** sees everything they uploaded,
     * - a squad in the league sees the league-wide album,
     * - a **fixture's** album belongs to the two squads that played it, nobody
     *   else — not the rest of the league, not the losing captain's cousin.
     *
     * The filter runs on the server for every read, because hiding rows in the
     * UI would still ship them over the wire.
     */
    public function index(Request $request, int $id): JsonResponse
    {
        $access = LeagueStore::leagueAccess($id, (int) $request->query('userId', 0) ?: 0);

        if (! $access) {
            return $this->fail('That league no longer exists 🛡️', 404, ['media' => []]);
        }

        $userId = (int) $request->query('userId', 0) ?: 0;

        $rows = TournamentMedia::where('tournament_id', $id)->get();
        $matches = TournamentMatch::where('tournament_id', $id)->get()->keyBy('id');
        $allUsers = User::all()->keyBy('id');

        $viewer = [
            'isHost' => $access['isHost'],
            'teamIds' => $access['myTeamIds'],
            'canSeeInside' => $access['canSeeInside'],
        ];

        $media = $rows
            ->filter(function ($m) use ($matches, $viewer) {
                $match = $m->match_id ? $matches->get((int) $m->match_id) : null;
                $squads = $match ? [(int) $match->home_team_id, (int) $match->away_team_id] : [];

                return LeagueStore::canViewMedia(
                    ['matchId' => $m->match_id !== null ? (int) $m->match_id : null],
                    $squads,
                    $viewer
                );
            })
            ->sortByDesc(fn ($m) => $m->created_at?->getTimestamp() ?? 0)
            ->values()
            ->map(function ($m) use ($matches, $allUsers, $access, $userId) {
                $match = $m->match_id ? $matches->get((int) $m->match_id) : null;

                return [
                    'id' => $m->id,
                    'matchId' => $m->match_id,
                    'kind' => $m->kind,
                    'url' => $m->url,
                    'caption' => $m->caption,
                    'credit' => $m->credit,
                    'uploadedBy' => $m->uploaded_by,
                    'uploaderName' => $allUsers->get((int) $m->uploaded_by)?->name ?? 'Host',
                    'createdAt' => $m->created_at,
                    'scope' => $match ? $match->round.' • a fixture album' : 'Whole league',
                    'canDelete' => $access['isHost'] && (int) $m->uploaded_by === $userId,
                ];
            })->all();

        return $this->ok([
            'media' => $media,
            'canUpload' => $access['isHost'],
            'isHost' => $access['isHost'],
        ]);
    }

    /**
     * POST — upload a photo, or paste an album link 🔗
     *
     * Only the host uploads: a league album is the organiser's record of the
     * season, and one camera is easier to keep tidy than twenty.
     *
     * `kind` decides what `url` is: `file` holds a data URL the browser read off
     * the host's disk (the same trick the receipt uploader uses, no storage
     * service needed), `link` holds an https:// address of an album on Google
     * Drive, Facebook or wherever the host already keeps photos.
     */
    public function store(Request $request, int $id): JsonResponse
    {
        $action = (string) $request->input('action', 'add');
        $userId = (int) $request->input('userId', 0);

        $league = Tournament::find($id);

        if (! $league) {
            return $this->fail('That league no longer exists 🛡️', 404);
        }

        if ((int) $league->host_id !== $userId) {
            return $this->fail(
                'Only the host adds to the album 👑 — send them your photos and they’ll post them.',
                403
            );
        }

        if ($action === 'delete') {
            $mediaId = (int) $request->input('mediaId', 0);
            $row = TournamentMedia::where('id', $mediaId)->where('tournament_id', $id)->first();

            if (! $row) {
                return $this->fail('That photo isn’t in this league 📸', 404);
            }

            $row->delete();

            return $this->ok(['ok' => true, 'message' => 'Removed from the album 🗑️']);
        }

        if ($action !== 'add') {
            return $this->fail('Unknown action — add or delete 📸', 400);
        }

        $kind = (string) $request->input('kind', 'link') === 'file' ? 'file' : 'link';
        $url = trim((string) $request->input('url', ''));
        $caption = mb_substr(trim((string) $request->input('caption', '')), 0, 160);
        $credit = mb_substr(trim((string) $request->input('credit', '')), 0, 80);
        $matchId = (int) $request->input('matchId', 0) ?: null;

        if ($url === '') {
            return $this->fail('Add a photo or paste a link first 📸', 400);
        }

        if ($kind === 'link') {
            $error = Validation::externalUrl($url);

            if ($error) {
                return $this->fail($error, 400);
            }
        } elseif (! str_starts_with($url, 'data:image/')) {
            return $this->fail('That upload didn’t come through as an image — try again 📸', 400);
        }

        if (mb_strlen($url) > self::MAX_MEDIA_CHARS) {
            return $this->fail('That photo is over 2MB — a smaller one, or paste a Drive link instead 🔗', 400);
        }

        $match = null;

        if ($matchId) {
            $match = TournamentMatch::where('id', $matchId)->where('tournament_id', $id)->first();

            if (! $match) {
                return $this->fail('That fixture isn’t in this league 🛡️', 400);
            }
        }

        $media = TournamentMedia::create([
            'tournament_id' => $id,
            'match_id' => $matchId,
            'kind' => $kind,
            'url' => $url,
            'caption' => $caption,
            'credit' => $credit,
            'uploaded_by' => $userId,
        ]);

        // Tell the squads who can actually see it. A fixture photo goes to the
        // two captains; a league-wide one goes to every squad in the league —
        // and to nobody else, which is the rule the GET above enforces.
        $squads = LeagueStore::approvedSquads($id);

        $audience = collect($squads)->pluck('captainId')->map(fn ($v) => (int) $v)->all();

        if ($matchId && $match) {
            $ids = [(int) $match->home_team_id, (int) $match->away_team_id];
            $audience = collect($squads)->filter(fn ($s) => in_array((int) $s['teamId'], $ids, true))
                ->pluck('captainId')->map(fn ($v) => (int) $v)->all();
        }

        foreach ($audience as $captainId) {
            Notifier::notify(
                $captainId,
                'league',
                '📸 New '.($matchId ? 'match' : 'league')." photos — {$league->name}",
                $caption !== '' ? $caption : 'The host added photos from the league. Open the album to see them.',
                "/leagues/{$id}"
            );
        }

        return $this->ok([
            'ok' => true,
            'media' => $media,
            'message' => $matchId
                ? 'Added to that fixture’s album — the two squads and you can see it 📸'
                : 'Added to the league album — every squad in it can see it 📸',
        ]);
    }
}
