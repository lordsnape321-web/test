<?php

namespace App\Services;

use App\Models\EmailOutbox;
use App\Models\User;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\View;

/**
 * The app's postbox — everything that leaves as an email goes through here.
 *
 * Two rules shape it:
 *
 *   1. Sending is never part of the response. A booking confirmation must not
 *      wait on Gmail's SMTP handshake (or fail the request when the wifi drops),
 *      so messages are written to `email_outbox` and drained by the next few API
 *      calls — see App\Http\Middleware\PumpOutbox. The user's workflow has no
 *      queue worker or scheduler, and this needs neither.
 *   2. A broken inbox is never a broken app. Every failure is logged, the row
 *      keeps its error, and the caller carries on.
 *
 * Transport is chosen entirely by `.env`: with `MAIL_MAILER=smtp` plus Gmail
 * credentials every message is a real email; with the default `log` driver the
 * same messages are written to `storage/logs/laravel.log`, so a fresh clone
 * works before anyone has an app password.
 */
class Mailer
{
    /** How many times a message is retried before it is parked as failed. */
    private const MAX_ATTEMPTS = 3;

    /**
     * Is a real transport configured?
     *
     * `smtp` without a username is almost always an unfinished `.env`, and the
     * health endpoint reports this so "no emails are arriving" has an answer
     * before anyone reads the logs.
     */
    public static function configured(): bool
    {
        $default = (string) config('mail.default', 'log');

        if ($default === 'log' || $default === 'array') {
            return false;
        }

        if ($default === 'smtp' && (string) config('mail.mailers.smtp.username', '') === '') {
            return false;
        }

        return true;
    }

    /**
     * Queue one email. Returns the row, or null when there is nowhere to send it.
     *
     * @param  array{
     *     to?: string,
     *     name?: string,
     *     userId?: int|null,
     *     subject: string,
     *     type?: string,
     *     template?: string,
     *     payload?: array<string, mixed>
     * }  $input
     */
    public static function queue(array $input): ?EmailOutbox
    {
        $to = strtolower(trim((string) ($input['to'] ?? '')));

        if ($to === '' || ! filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return null;
        }

        try {
            return EmailOutbox::create([
                'user_id' => $input['userId'] ?? null,
                'to_email' => $to,
                'to_name' => $input['name'] ?? null,
                'subject' => mb_substr((string) $input['subject'], 0, 250),
                'template' => (string) ($input['template'] ?? 'notice'),
                'type' => (string) ($input['type'] ?? 'info'),
                'payload' => $input['payload'] ?? [],
                'status' => 'pending',
                'attempts' => 0,
                'available_at' => now(),
            ]);
        } catch (\Throwable $e) {
            // The outbox table is created by `php artisan serve`; a request that
            // somehow arrives first must still succeed.
            report($e);

            return null;
        }
    }

    /**
     * Queue an email for an account, honouring the preference that governs it.
     *
     * @param  'notifications'|'reminders'|'always'  $preference
     * @param  array<string, mixed>  $payload
     */
    public static function queueForUser(?User $user, string $subject, array $payload, string $preference = 'notifications'): ?EmailOutbox
    {
        if (! $user || (string) $user->email === '') {
            return null;
        }

        if ($preference === 'notifications' && ! $user->wantsBookingEmails()) {
            return null;
        }

        if ($preference === 'reminders' && ! $user->wantsReminders()) {
            return null;
        }

        return self::queue([
            'to' => (string) $user->email,
            'name' => (string) $user->name,
            'userId' => (int) $user->id,
            'subject' => $subject,
            'type' => (string) ($payload['type'] ?? 'info'),
            'payload' => $payload,
        ]);
    }

    /**
     * Send a few queued messages. Safe to call on any request.
     *
     * @return int how many were sent
     */
    public static function flush(int $limit = 2, float $budgetSeconds = 6.0): int
    {
        try {
            $rows = EmailOutbox::query()
                ->where('status', 'pending')
                ->where(fn ($q) => $q->whereNull('available_at')->orWhere('available_at', '<=', now()))
                ->orderBy('id')
                ->limit(max(1, $limit))
                ->get();
        } catch (\Throwable $e) {
            // Storage not prepared yet — nothing to drain.
            return 0;
        }

        $started = microtime(true);
        $sent = 0;

        foreach ($rows as $row) {
            if (microtime(true) - $started > $budgetSeconds) {
                break;
            }

            if (self::deliver($row)) {
                $sent++;
            }
        }

        return $sent;
    }

    /** Render, send and record one row. */
    private static function deliver(EmailOutbox $row): bool
    {
        $payload = is_array($row->payload) ? $row->payload : [];

        try {
            $html = View::make('emails.notice', self::viewData($row, $payload))->render();

            Mail::html($html, function ($message) use ($row) {
                $message->to((string) $row->to_email, (string) ($row->to_name ?? ''))
                    ->subject((string) $row->subject);
            });

            $row->forceFill([
                'status' => 'sent',
                'sent_at' => now(),
                'attempts' => (int) $row->attempts + 1,
                'error' => null,
            ])->save();

            return true;
        } catch (\Throwable $e) {
            $attempts = (int) $row->attempts + 1;

            $row->forceFill([
                'attempts' => $attempts,
                // Park it after a few tries — a bad address or a missing app
                // password should not retry forever on every request.
                'status' => $attempts >= self::MAX_ATTEMPTS ? 'failed' : 'pending',
                'available_at' => now()->addMinutes(5 * $attempts),
                'error' => mb_substr($e->getMessage(), 0, 500),
            ])->save();

            Log::warning('Email send failed', [
                'outbox_id' => $row->id,
                'to' => $row->to_email,
                'attempts' => $attempts,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private static function viewData(EmailOutbox $row, array $payload): array
    {
        $appName = (string) (config('app.name') ?: 'Futsal Nepal');

        return [
            'appName' => $appName,
            'preheader' => (string) ($payload['preheader'] ?? $payload['heading'] ?? $row->subject),
            'eyebrow' => $payload['eyebrow'] ?? null,
            'heading' => (string) ($payload['heading'] ?? $row->subject),
            'intro' => $payload['intro'] ?? [],
            'code' => $payload['code'] ?? null,
            'rows' => is_array($payload['rows'] ?? null) ? $payload['rows'] : [],
            'cta' => self::cta($payload),
            'footnote' => $payload['footnote'] ?? null,
            'recipient' => (string) ($row->to_name ?? ''),
            'link' => self::portalLink($payload),
        ];
    }

    /**
     * The button, when there is both a label and somewhere to point it.
     *
     * `link` is a route inside the Expo app ("/bookings?focus=12"); it becomes a
     * real URL only on a deployment that knows its own address, which is why the
     * button is optional rather than assumed.
     *
     * @param  array<string, mixed>  $payload
     * @return array{label: string, url: string}|null
     */
    private static function cta(array $payload): ?array
    {
        $cta = is_array($payload['cta'] ?? null) ? $payload['cta'] : [];
        $label = (string) ($cta['label'] ?? $payload['ctaLabel'] ?? '');
        $url = (string) ($cta['url'] ?? '');

        if ($url === '') {
            $url = (string) (self::portalLink($payload) ?? '');
        }

        if ($label === '' || $url === '') {
            return null;
        }

        return ['label' => $label, 'url' => $url];
    }

    /**
     * A tappable link back into the app, when the deployment knows its own
     * address. Localhost is deliberately skipped: "http://localhost:8000/bookings"
     * in a player's inbox is worse than no button at all.
     */
    private static function portalLink(array $payload): ?string
    {
        $path = (string) ($payload['link'] ?? '');

        if ($path === '') {
            return null;
        }

        $base = (string) config('app.url', '');

        if ($base === '' || ! filter_var($base, FILTER_VALIDATE_URL)) {
            return null;
        }

        $host = (string) parse_url($base, PHP_URL_HOST);

        if (in_array($host, ['localhost', '127.0.0.1', '::1'], true)) {
            return null;
        }

        return rtrim($base, '/').'/'.ltrim($path, '/');
    }
}
