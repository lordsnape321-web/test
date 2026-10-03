<?php

namespace App\Http\Controllers\Api;

use App\Models\EmailOutbox;
use App\Services\Mailer;
use App\Services\MailPump;
use App\Services\PushSender;
use App\Support\League;
use App\Support\Loyalty;
use App\Support\PerfLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class HealthController extends ApiController
{
    /**
     * GET /api/health — is the API up, and can it reach the database?
     *
     * A database failure is deliberately returned as a structured 503 instead
     * of `{ ok: false }` with no explanation. `apiJson()` can then show the
     * actual local PDO/Laravel error, which makes a missing `pdo_mysql`
     * extension, wrong MySQL credentials, or an uncreated database immediately
     * actionable.
     */
    public function __invoke(): JsonResponse
    {
        try {
            DB::select('select 1');

            $build = self::buildId();

            return $this->ok([
                'ok' => true,
                /*
                 * Which commit this server is running.
                 *
                 * This was a hand-maintained constant, and it drifted four
                 * commits behind — a build id that has to be remembered is a
                 * build id that is wrong, which is exactly the thing it was
                 * meant to prevent. It is now read from `.git`.
                 *
                 * A checkout with no git metadata (a ZIP download, a container
                 * that copied files in) reports `null` rather than guessing:
                 * naming a commit that is not the one running is worse than
                 * admitting the id is unknown, and `code` below answers the
                 * question people actually have.
                 */
                'build' => $build,
                'buildSource' => $build ? 'git' : 'unknown',
                /*
                 * Does this server have the fixes that broke something visible?
                 *
                 * Round 7 was lost to a `php artisan serve` process running code
                 * from before a one-line fix, and "the app is still broken" is a
                 * very expensive way to find that out. Each key is a fix that
                 * shipped; `false` means this checkout predates it. Cheap
                 * `class_exists`/`method_exists` lookups — no new queries.
                 */
                'code' => [
                    // Scoring a competition game 500'd on a missing import.
                    'leagueScoreFix' => class_exists(League::class) && method_exists(League::class, 'recordFor'),
                    // The rating moved on attendance only, never on payment:
                    // the fix brought the late-payment credit and the shared
                    // column list the rating reads.
                    'paymentAwareRatingFix' => defined(Loyalty::class.'::TRUST_PAID_LATE_BOOST')
                        && defined(Loyalty::class.'::HISTORY_COLUMNS')
                        && method_exists(Loyalty::class, 'bookingSettled'),
                    // Push notifications exist as a transport at all.
                    'pushNotifications' => class_exists(PushSender::class),
                ],
                // "Nobody is getting our emails" is usually one of three things:
                // the driver is still `log`, the app password is missing, or a
                // message is stuck in the outbox. This answers it in one call.
                'mail' => [
                    'configured' => Mailer::configured(),
                    'driver' => (string) config('mail.default'),
                    'from' => (string) config('mail.from.address'),
                    'pending' => $this->pendingMail(),
                    // "background" means the API never talks to Gmail itself:
                    // a helper process does, started on demand. "inline" means
                    // the host would not let us spawn one and requests are
                    // covering for it — which is worth seeing here.
                    'drain' => MailPump::mode(),
                ],
                // How fast this server is actually answering: median and p95
                // over the last few hundred requests, plus the slowest ones
                // with their query counts. See config/perf.php.
                'perf' => PerfLog::summary(),
            ]);
        } catch (\Throwable $e) {
            report($e);

            $message = config('app.debug')
                ? 'Database connection failed: '.$e->getMessage()
                : 'Database connection failed. Check the Laravel database configuration.';

            return $this->fail($message, 503, ['ok' => false]);
        }
    }

    /**
     * The commit this checkout is on, or null when there is no git metadata.
     *
     * Deliberately forgiving: this runs on a health check, so a missing file, a
     * packed ref, or a `.git` file (worktrees and submodules point elsewhere)
     * must return null rather than throw. The caller falls back to the constant.
     */
    private static function buildId(): ?string
    {
        try {
            $git = self::gitDir();

            if (! $git) {
                return null;
            }

            $head = trim((string) @file_get_contents($git.'/HEAD'));

            if ($head === '') {
                return null;
            }

            // A detached HEAD *is* the SHA; a branch name points at a ref file,
            // which may live loose or packed depending on when it was last
            // fetched.
            if (! str_starts_with($head, 'ref: ')) {
                return mb_substr($head, 0, 7);
            }

            $ref = trim(substr($head, 5));
            $loose = @file_get_contents($git.'/'.$ref);

            if (is_string($loose) && trim($loose) !== '') {
                return mb_substr(trim($loose), 0, 7);
            }

            foreach (explode("\n", (string) @file_get_contents($git.'/packed-refs')) as $line) {
                $line = trim($line);

                if ($line !== '' && str_ends_with($line, ' '.$ref)) {
                    return mb_substr($line, 0, 7);
                }
            }

            return null;
        } catch (\Throwable) {
            return null;
        }
    }

    /** The nearest `.git` at or above the app, following a worktree pointer. */
    private static function gitDir(): ?string
    {
        $dir = base_path();

        for ($up = 0; $up < 4 && $dir !== '' && $dir !== '/'; $up++) {
            $candidate = $dir.'/.git';

            if (is_dir($candidate)) {
                return $candidate;
            }

            if (is_file($candidate)) {
                $pointer = trim((string) @file_get_contents($candidate));

                return str_starts_with($pointer, 'gitdir:') ? trim(substr($pointer, 7)) : null;
            }

            $dir = dirname($dir);
        }

        return null;
    }

    /** Queued emails waiting to go out; 0 when the outbox does not exist yet. */
    private function pendingMail(): int
    {
        try {
            return (int) EmailOutbox::where('status', 'pending')->count();
        } catch (\Throwable $e) {
            return 0;
        }
    }
}
