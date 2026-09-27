<?php

namespace App\Http\Controllers\Api;

use App\Models\Notification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The app's bell. Notifications are written by every other part of the API and
 * read back here; this route is also the only place they are marked read.
 */
class NotificationController extends ApiController
{
    private const VALID_TYPES = [
        'info',
        'booking_request',
        'booking_confirmed',
        'booking_rejected',
        'booking_cancelled',
        'payment',
        'match_join',
        'free_play',
        'review',
    ];

    /** GET /api/notifications?userId= — the last hundred, newest first. */
    public function index(Request $request): JsonResponse
    {
        $userId = (int) $request->query('userId', 0);

        if ($userId <= 0) {
            return response()
                ->json(['notifications' => [], 'unread' => 0])
                ->header('Cache-Control', 'no-store, no-cache, must-revalidate');
        }

        $rows = Notification::where('user_id', $userId)->orderByDesc('created_at')->orderByDesc('id')->limit(100)->get();

        return response()
            ->json([
                'notifications' => $rows->map(fn (Notification $n) => $n->toArray())->all(),
                'unread' => $rows->filter(fn (Notification $n) => ! (bool) $n->is_read)->count(),
            ])
            ->header('Cache-Control', 'no-store, no-cache, must-revalidate');
    }

    /** POST /api/notifications — push one in (used by the client for local alerts). */
    public function store(Request $request): JsonResponse
    {
        $userId = (int) $request->input('userId', 0);
        $title = trim((string) $request->input('title', ''));

        if ($userId <= 0 || $title === '') {
            return $this->fail('userId and title required 🔔', 400);
        }

        if (mb_strlen($title) > 200) {
            return $this->fail('Title too long (max 200) 🔔', 400);
        }

        $type = (string) $request->input('type', 'info');

        if (! in_array($type, self::VALID_TYPES, true)) {
            return $this->fail('Invalid notification type 🔔', 400);
        }

        $row = Notification::create([
            'user_id' => $userId,
            'type' => $type,
            'title' => mb_substr($title, 0, 200),
            'message' => mb_substr((string) $request->input('message', ''), 0, 1000),
            'link' => mb_substr((string) $request->input('link', ''), 0, 300),
            'is_read' => false,
        ]);

        return $this->ok(['notification' => $row->toArray()], 201);
    }

    /** PATCH /api/notifications/{id} — mark read (or unread). */
    public function update(Request $request, int $id): JsonResponse
    {
        $isRead = $request->has('isRead') ? $request->boolean('isRead') : true;

        Notification::where('id', $id)->update(['is_read' => $isRead]);

        return $this->ok(['notification' => Notification::find($id)?->toArray()]);
    }

    /** DELETE /api/notifications/{id} — drop one from the bell. */
    public function destroy(int $id): JsonResponse
    {
        Notification::where('id', $id)->delete();

        return $this->ok(['ok' => true]);
    }

    /** POST /api/notifications/read-all — clear the badge. */
    public function readAll(Request $request): JsonResponse
    {
        $userId = (int) $request->input('userId', 0);

        if (! $userId) {
            return $this->fail('userId required', 400);
        }

        Notification::where('user_id', $userId)->update(['is_read' => true]);

        return $this->ok(['ok' => true]);
    }
}
