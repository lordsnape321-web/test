<?php

namespace App\Services;

use App\Models\Notification;

/**
 * The app's bell — `src/lib/notify.ts`.
 *
 * Every "something happened to your game" message in the product goes through
 * here, so a booking confirmation and a league invite end up in the same place
 * with the same shape (`link` is a route in the Expo app, e.g. "/bookings").
 *
 * Delivery is best-effort: a notification is never worth failing the request
 * that triggered it, so a broken row logs and moves on.
 */
class Notifier
{
    /**
     * @param  array{userId: int, type: string, title: string, message?: string, link?: string}  $input
     */
    public static function send(array $input): ?Notification
    {
        $userId = (int) ($input['userId'] ?? 0);

        if ($userId <= 0) {
            return null;
        }

        try {
            return Notification::create([
                'user_id' => $userId,
                'type' => (string) ($input['type'] ?? 'info'),
                'title' => (string) ($input['title'] ?? ''),
                'message' => (string) ($input['message'] ?? ''),
                'link' => (string) ($input['link'] ?? ''),
                'is_read' => false,
            ]);
        } catch (\Throwable $e) {
            report($e);

            return null;
        }
    }

    /** Convenience wrapper matching the call sites in the Next.js routes. */
    public static function notify(int $userId, string $type, string $title, string $message = '', string $link = ''): ?Notification
    {
        return self::send([
            'userId' => $userId,
            'type' => $type,
            'title' => $title,
            'message' => $message,
            'link' => $link,
        ]);
    }
}
