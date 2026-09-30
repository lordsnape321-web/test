<?php

namespace App\Http\Middleware;

use App\Services\Mailer;
use App\Support\GameReminders;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

/**
 * The deployment has no queue worker and no scheduler — the user runs
 * `php artisan serve` and `npx expo start`, and nothing else — so the two jobs
 * that would normally live there are pumped by ordinary API traffic:
 *
 *   • queued email is delivered a couple of messages at a time, and
 *   • games starting soon get their reminder.
 *
 * Both are cheap and both are best-effort. This runs *after* the response has
 * been sent (`terminate`), so a slow Gmail handshake can never delay a player's
 * booking; and the reminder scan runs at most once every few minutes, because
 * the app polls and every poll is a request.
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
     * Runs after the response is flushed to the client.
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
            // Two per request, five seconds in total: enough to clear a burst
            // (a squad of confirmations) over the next few calls, small enough
            // that a dead SMTP host cannot tie the server up. `php artisan serve`
            // is single-threaded, which is the other reason this is capped
            // rather than "drain everything".
            Mailer::flush(2, 5.0);
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
