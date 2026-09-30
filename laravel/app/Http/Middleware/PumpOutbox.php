<?php

namespace App\Http\Middleware;

use App\Services\MailPump;
use App\Support\GameReminders;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

/**
 * The deployment has no queue worker and no scheduler — the user runs
 * `php artisan serve` and `npx expo start`, and nothing else — so the two jobs
 * that would normally live there are kicked off by ordinary API traffic:
 *
 *   • games starting soon get their reminder, and
 *   • the outbox gets drained *by a separate process* (App\Services\MailPump).
 *
 * Both run after the response (`terminate`) and both are best-effort.
 *
 * The important word is "kicked off". An earlier version sent the mail right
 * here, after the response — which is not free: `php artisan serve` answers one
 * request at a time, so five seconds spent talking to Gmail is five seconds in
 * which every other screen times out. With the app polling every few seconds,
 * that is not a delay, it is a dead API. Now the request only writes a stamp
 * file and launches the helper, which costs microseconds and nothing else.
 */
class PumpOutbox
{
    /** How often the "any games coming up?" scan may run. */
    private const REMINDER_EVERY_SECONDS = 300;

    public function handle(Request $request, Closure $next): Response
    {
        return $next($request);
    }

    /**
     * Runs after the response has been flushed to the client.
     */
    public function terminate(Request $request, Response $response): void
    {
        try {
            if ($this->dueForReminderScan()) {
                GameReminders::dispatch();
            }
        } catch (\Throwable $e) {
            report($e);
        }

        try {
            // Cheap by design: one EXISTS query when there is nothing queued,
            // and a spawn at most once every few seconds when there is.
            MailPump::tick();
        } catch (\Throwable $e) {
            report($e);
        }
    }

    /**
     * A file-cache lock, so a page that fires six requests at once still scans
     * once. Any failure here reads as "not due" rather than "crash the request".
     */
    private function dueForReminderScan(): bool
    {
        try {
            return (bool) Cache::store('file')->add('game-reminders:scan', true, self::REMINDER_EVERY_SECONDS);
        } catch (\Throwable $e) {
            return false;
        }
    }
}
