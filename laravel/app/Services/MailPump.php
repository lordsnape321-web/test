<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;

/**
 * Starts the background mail drain — and is the reason the API stays fast.
 *
 * The first cut of this drained the outbox inside `terminate()`, after the
 * response. That is not enough here: `php artisan serve` runs *one* request at
 * a time, so a request that is off talking to Gmail for five seconds is a
 * request that is not answering anybody else. The app polls every few seconds
 * (the inbox alone polls every 4s), so the backlog grew faster than it drained
 * and every screen started timing out.
 *
 * So: the request does not send anything. It nudges a helper process
 * (`php artisan mail:drain`) and returns immediately. The helper owns the SMTP
 * connection and the retry bookkeeping; a slow Gmail handshake costs the helper
 * time and nobody else.
 *
 * Everything here is best-effort. If the host forbids spawning processes, the
 * caller falls back to one message per request with a long throttle between
 * attempts (`MailPump::tick()` returns 'inline' when that happens, and
 * `GET /api/health` reports it) — slow mail beats a slow app, but a slow app is
 * still the worse failure.
 */
class MailPump
{
    /** At most one spawn attempt per this many seconds, however hard the app polls. */
    private const SPAWN_EVERY_SECONDS = 3;

    /**
     * A drain that has claimed to be running for longer than this is presumed
     * dead (killed terminal, crashed PHP) and its marker is ignored.
     */
    private const RUNNING_GRACE_SECONDS = 90;

    /** The fallback's budget: how often a request may block, and for how long. */
    private const INLINE_EVERY_SECONDS = 20;

    private const INLINE_BUDGET_SECONDS = 3.0;

    /** Rotate the drain log once it gets silly, so a stuck drain cannot fill the disk. */
    private const MAX_LOG_BYTES = 262_144;

    /**
     * Decide what to do about the outbox, and do it.
     *
     * @return 'idle'|'busy'|'background'|'inline' — what happened, for the log
     *                                                and for /api/health.
     */
    public static function tick(): string
    {
        if (! Mailer::hasPending()) {
            // The common case, and the cheap one: one indexed EXISTS query.
            return 'idle';
        }

        if (self::running() || self::recent(self::stampPath('spawn'), self::SPAWN_EVERY_SECONDS)) {
            // A helper is already on it, or one was started moments ago.
            return 'busy';
        }

        if (self::recent(self::path('log'), 60)) {
            // The helper is failing before it can send — a bad PHP path, a
            // missing command, a crash. Starting another one every three
            // seconds would only burn CPU; its output is in the log and
            // /api/health keeps reporting the backlog.
            return 'busy';
        }

        self::touch(self::stampPath('spawn'));

        if (self::spawn()) {
            return 'background';
        }

        // No way to spawn: pay the price in this request, but rarely, and one
        // message at a time. A request that waits three seconds every twenty is
        // survivable; one that waits every time is what broke the app.
        if (self::recent(self::stampPath('inline'), self::INLINE_EVERY_SECONDS)) {
            return 'busy';
        }

        $firstTime = ! self::recent(self::stampPath('inline'), 3600);
        self::touch(self::stampPath('inline'));

        $lock = self::lock();

        if ($lock === null) {
            return 'busy';
        }

        try {
            Mailer::flush(1, self::INLINE_BUDGET_SECONDS);
        } finally {
            self::release($lock);
        }

        if ($firstTime) {
            // Once an hour is enough to explain the slowness in the log; the
            // health endpoint says it on every call.
            Log::warning('Mail is being sent inside requests: the background drain could not be started.');
        }

        return 'inline';
    }

    /** How this host delivers mail, for `GET /api/health`. */
    public static function mode(): string
    {
        if (! self::canSpawn()) {
            return 'inline';
        }

        return self::running() ? 'background-running' : 'background';
    }

    /**
     * Launch `php artisan mail:drain` detached.
     *
     * Deliberately fire-and-forget: nothing here waits for the child, reads its
     * output or depends on it having finished. It writes to its own log (see
     * `path()`), and Laravel's log inside it.
     */
    public static function spawn(): bool
    {
        $artisan = base_path('artisan');

        if (! is_file($artisan) || ! self::canSpawn()) {
            return false;
        }

        $binary = (string) PHP_BINARY;
        $command = escapeshellarg($binary).' '.escapeshellarg($artisan).' mail:drain --quiet';
        $log = escapeshellarg(self::path('log'));

        try {
            self::rotateLog();

            if (PHP_OS_FAMILY === 'Windows') {
                // `start /B` launches without a console window and returns at
                // once, so pclose() does not wait for the drain to finish.
                $handle = @popen('start /B "" '.$command.' >> '.$log.' 2>&1', 'r');

                if (! is_resource($handle)) {
                    return false;
                }

                @pclose($handle);

                return true;
            }

            // `nohup ... &` is the plainest way to survive the shell exiting;
            // exec() returns as soon as the job is backgrounded.
            @exec('nohup '.$command.' >> '.$log.' 2>&1 < /dev/null &');

            return true;
        } catch (\Throwable $e) {
            report($e);

            return false;
        }
    }

    /** Can this PHP even start a process? */
    private static function canSpawn(): bool
    {
        return PHP_OS_FAMILY === 'Windows' ? function_exists('popen') : function_exists('exec');
    }

    /** A non-blocking flock shared by the helper and the inline fallback. */
    public static function lock(): mixed
    {
        $path = self::path('lock');
        $handle = @fopen($path, 'c');

        if (! $handle) {
            return null;
        }

        if (! @flock($handle, LOCK_EX | LOCK_NB)) {
            fclose($handle);

            return null;
        }

        return $handle;
    }

    public static function release(mixed $handle): void
    {
        if (is_resource($handle)) {
            @flock($handle, LOCK_UN);
            @fclose($handle);
        }
    }

    /** Claim that this process is draining, so other requests do not start another. */
    public static function claimRunning(): void
    {
        self::touch(self::path('running'));
    }

    public static function releaseRunning(): void
    {
        @unlink(self::path('running'));
    }

    /** Is a helper mid-drain? */
    public static function running(): bool
    {
        return self::recent(self::path('running'), self::RUNNING_GRACE_SECONDS);
    }

    /** Where the helper's stdout/stderr goes: only ever written to on a bad day. */
    public static function logPath(): string
    {
        return self::path('log');
    }

    private static function recent(string $path, int $seconds): bool
    {
        $at = @filemtime($path);

        return $at !== false && (time() - $at) < $seconds;
    }

    private static function touch(string $path): void
    {
        @touch($path);
    }

    private static function path(string $name): string
    {
        return storage_path('framework/mail-'.$name);
    }

    private static function stampPath(string $name): string
    {
        return self::path($name.'.stamp');
    }

    private static function rotateLog(): void
    {
        $log = self::path('log');

        if (is_file($log) && (int) @filesize($log) > self::MAX_LOG_BYTES) {
            @unlink($log);
        }
    }
}
