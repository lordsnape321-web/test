<?php

namespace App\Services;

use App\Models\Notification;
use App\Models\User;

/**
 * The app's bell — `src/lib/notify.ts`.
 *
 * Every "something happened to your game" message in the product goes through
 * here, so a booking confirmation and a league invite end up in the same place
 * with the same shape (`link` is a route in the Expo app, e.g. "/bookings").
 *
 * Delivery is best-effort and three-legged: the bell row (always), an email for
 * the types worth an inbox (see EMAIL_TYPES), and a push to every phone the
 * account registered (see App\Services\PushSender). A notification is never
 * worth failing the request that triggered it, so a broken leg logs and moves on.
 *
 * Since this is the single funnel, it is also where email is decided: a type in
 * EMAIL_TYPES is *also* sent to the account's inbox, queued (never awaited) and
 * subject to the player's settings switch. Game reminders are deliberately not
 * in the map — App\Support\GameReminders writes a richer message with the venue
 * and kick-off time, and would otherwise send two emails for one game.
 *
 * It is also where push is decided. PUSH_TYPES is deliberately the same list as
 * EMAIL_TYPES: the test there is "would you be annoyed to find out later?", and
 * that question does not change because the phone happens to be in a pocket.
 * Chit-chat (reviews, promo chatter) stays in the bell where it can wait.
 */
class Notifier
{
    /**
     * Types worth an email.
     *
     * The test is "would you be annoyed to find out later?" — a confirmed,
     * declined or cancelled booking, money, a game you are in, and a squad
     * invitation. Chit-chat like reviews and promo chatter stays in the app.
     */
    /**
     * Types worth a buzz on the phone.
     *
     * Same list, same reasoning as EMAIL_TYPES below — see the class docblock.
     */
    private const PUSH_TYPES = [
        'booking_request',
        'booking_confirmed',
        'booking_rejected',
        'booking_cancelled',
        'payment',
        'match_join',
        'team_invite',
        'league',
        'game_reminder',
    ];

    private const EMAIL_TYPES = [
        'booking_request',
        'booking_confirmed',
        'booking_rejected',
        'booking_cancelled',
        'payment',
        'match_join',
        'team_invite',
        'league',
    ];

    /**
     * @param  array{userId: int, type: string, title: string, message?: string, link?: string, email?: bool}  $input
     */
    public static function send(array $input): ?Notification
    {
        $userId = (int) ($input['userId'] ?? 0);

        if ($userId <= 0) {
            return null;
        }

        $type = (string) ($input['type'] ?? 'info');
        $title = (string) ($input['title'] ?? '');
        $message = (string) ($input['message'] ?? '');
        $link = (string) ($input['link'] ?? '');

        $notification = self::write($userId, $type, $title, $message, $link);

        if (($input['email'] ?? true) !== false) {
            self::email($userId, $type, $title, $message, $link);
        }

        self::push($userId, $type, $title, $message, $link);

        return $notification;
    }

    /** Convenience wrapper used by the API controllers. */
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

    /** The bell row. Never throws. */
    private static function write(int $userId, string $type, string $title, string $message, string $link): ?Notification
    {
        try {
            return Notification::create([
                'user_id' => $userId,
                'type' => $type,
                'title' => $title,
                'message' => $message,
                'link' => $link,
                'is_read' => false,
            ]);
        } catch (\Throwable $e) {
            report($e);

            return null;
        }
    }

    /**
     * The same message, one row in the email outbox.
     *
     * Queued, so the request that caused it is unaffected by SMTP — and skipped
     * entirely when the player turned booking emails off, when the account has no
     * address, or when `type` is not one people want in their inbox.
     */
    private static function email(int $userId, string $type, string $title, string $message, string $link): void
    {
        if (! in_array($type, self::EMAIL_TYPES, true)) {
            return;
        }

        try {
            $user = User::find($userId);

            if (! $user) {
                return;
            }

            Mailer::queueForUser($user, $title, [
                'type' => $type,
                'heading' => $title,
                'preheader' => $message,
                'intro' => $message !== '' ? [$message] : [],
                'ctaLabel' => self::ctaLabel($type),
                'link' => $link,
            ]);
        } catch (\Throwable $e) {
            report($e);
        }
    }

    /**
     * The same message again, onto the phones.
     *
     * Only for types worth interrupting someone for, and only for phones that
     * registered — `PushSender` checks the account switch and the token list, so
     * an install with no Expo project set up simply sends nothing.
     */
    private static function push(int $userId, string $type, string $title, string $message, string $link): void
    {
        if (! in_array($type, self::PUSH_TYPES, true)) {
            return;
        }

        PushSender::send($userId, $title, $message, ['type' => $type, 'link' => $link]);
    }

    private static function ctaLabel(string $type): string
    {
        return match ($type) {
            'booking_confirmed', 'booking_rejected', 'booking_cancelled' => 'Open my bookings',
            'booking_request' => 'Review the request',
            'payment' => 'See the payment',
            'match_join' => 'See who is playing',
            'team_invite' => 'View the squad',
            default => 'Open the app',
        };
    }
}
