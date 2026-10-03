<?php

namespace App\Support;

use App\Models\Booking;
use App\Models\User;
use App\Services\Mailer;
use App\Services\Notifier;
use Illuminate\Support\Carbon;

/**
 * "Your game is in two hours" — the email people actually thank you for.
 *
 * There is no scheduler in this deployment (`php artisan serve` and nothing
 * else), so the pump is called from ordinary API traffic by
 * App\Http\Middleware\PumpOutbox and is throttled there to a few minutes. That
 * is plenty: a reminder that lands 115 minutes before kick-off is a reminder.
 *
 * `bookings.reminder_sent_at` is what keeps it to one message per game, even
 * though this code can run on every request; a booking whose date or time is
 * moved gets the column cleared by the update route, so the new time reminds
 * again.
 */
class GameReminders
{
    /** How far ahead the pump bothers looking. */
    private const HORIZON_HOURS = 48;

    private const DEFAULT_LEAD_MINUTES = 120;

    private const MIN_LEAD_MINUTES = 15;

    private const MAX_LEAD_MINUTES = 1440;

    /**
     * Send every reminder that has come due.
     *
     * @return int how many games were reminded
     */
    public static function dispatch(int $limit = 25): int
    {
        $sent = 0;

        try {
            $bookings = Booking::query()
                ->where('status', 'confirmed')
                ->whereNull('reminder_sent_at')
                ->where('date', '>=', now()->toDateString())
                ->where('date', '<=', now()->addHours(self::HORIZON_HOURS)->toDateString())
                ->orderBy('date')
                ->orderBy('start_time')
                ->limit($limit)
                ->get();
        } catch (\Throwable $e) {
            // Storage not prepared yet.
            return 0;
        }

        foreach ($bookings as $booking) {
            try {
                if (self::handle($booking)) {
                    $sent++;
                }
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return $sent;
    }

    private static function handle(Booking $booking): bool
    {
        $start = self::startAt($booking);

        // A booking we cannot place in time (bad row, deleted court) is marked
        // so it never blocks the queue behind it.
        if (! $start) {
            $booking->forceFill(['reminder_sent_at' => now()])->save();

            return false;
        }

        $minutesUntil = ($start->getTimestamp() - now()->getTimestamp()) / 60;

        if ($minutesUntil <= 0) {
            // Already kicked off — a reminder now would just be noise.
            $booking->forceFill(['reminder_sent_at' => now()])->save();

            return false;
        }

        $player = $booking->user_id ? User::find((int) $booking->user_id) : null;

        if ($minutesUntil > self::leadMinutes($player)) {
            return false;
        }

        self::remind($booking, $player, $start, (int) round($minutesUntil));

        $booking->forceFill(['reminder_sent_at' => now()])->save();

        return true;
    }

    private static function remind(Booking $booking, ?User $player, Carbon $start, int $minutesUntil): void
    {
        $venue = $booking->court?->venue?->name ?? 'your venue';
        $court = $booking->court?->name ?? 'the court';
        $when = Futsal::prettyDate((string) $booking->date).' at '.Futsal::formatTime12((string) $booking->start_time);
        $lead = self::leadLabel($minutesUntil);
        $ref = '#FN-'.$booking->id;

        if ($player) {
            Notifier::notify(
                (int) $player->id,
                'game_reminder',
                "⏰ Kick-off {$lead} — {$venue}",
                "Your game at {$court} starts {$when}. Bring a water bottle and a dark shirt! Booking {$ref}.",
                '/bookings?focus='.$booking->id
            );

            Mailer::queueForUser($player, "⏰ Your game starts {$lead} — {$venue}", [
                'type' => 'game_reminder',
                'eyebrow' => 'Game reminder',
                'heading' => "Kick-off {$lead}",
                'preheader' => "{$court} · {$when}",
                'intro' => [
                    "Your booking at {$venue} starts {$when}. See you on the turf!",
                ],
                'rows' => [
                    'Venue' => $venue,
                    'Court' => $court,
                    'When' => $when,
                    'Booking' => $ref,
                ],
                'ctaLabel' => 'View this booking',
                'link' => '/bookings?focus='.$booking->id,
                'footnote' => 'Running late or can’t make it? Let the venue know from the booking screen — a no-show costs you trust, a heads-up does not.',
            ], 'reminders');
        }
    }

    private static function startAt(Booking $booking): ?Carbon
    {
        $date = trim((string) $booking->date);
        $time = trim((string) $booking->start_time);

        if ($date === '' || $time === '') {
            return null;
        }

        try {
            return Carbon::parse($date.' '.$time);
        } catch (\Throwable $e) {
            return null;
        }
    }

    /** How long before kick-off this player wants the nudge. */
    private static function leadMinutes(?User $player): int
    {
        $minutes = (int) ($player?->reminder_minutes ?? self::DEFAULT_LEAD_MINUTES);

        if ($minutes <= 0) {
            $minutes = self::DEFAULT_LEAD_MINUTES;
        }

        return max(self::MIN_LEAD_MINUTES, min(self::MAX_LEAD_MINUTES, $minutes));
    }

    /**
     * "in 2 hours" / "in 45 minutes".
     *
     * Rounded down, so the email never promises more time than there is; the
     * exact kick-off time is in the details table either way.
     */
    private static function leadLabel(int $minutesUntil): string
    {
        $hours = (int) floor($minutesUntil / 60);

        if ($hours >= 1) {
            return "in {$hours} hour".($hours === 1 ? '' : 's');
        }

        return 'in '.max(1, $minutesUntil).' minutes';
    }
}
