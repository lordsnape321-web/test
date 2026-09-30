<?php

namespace App\Services;

use App\Models\EmailCode;

/**
 * The six-digit codes we email, for every reason we email one.
 *
 * Three flows use this and they are the same mechanism, so they are the same
 * service — only the wording of the email and the `purpose` differ:
 *
 *   • `password_reset` — "I forgot my password" (and, deliberately, an address
 *     that has no account gets the same answer as one that does);
 *   • `signup` — proving the address is real before the account exists;
 *   • `account_delete` — confirming a destructive action nobody can undo.
 *
 * Rules, enforced here so every flow agrees:
 *   • a code lives for 15 minutes;
 *   • five wrong guesses and it is dead;
 *   • five codes an hour per address and purpose, one a minute;
 *   • a code can only be spent once, and spending it kills its siblings.
 *
 * Codes are stored as a digest of purpose + address + digits, never in the
 * clear, so a database read does not hand anyone a working code.
 */
class EmailCodes
{
    public const PURPOSE_PASSWORD_RESET = 'password_reset';

    public const PURPOSE_SIGNUP = 'signup';

    public const PURPOSE_ACCOUNT_DELETE = 'account_delete';

    public const CODE_TTL_MINUTES = 15;

    public const MAX_ATTEMPTS = 5;

    public const MAX_PER_HOUR = 5;

    public const COOLDOWN_SECONDS = 60;

    /**
     * Create a code and return it, or say why not.
     *
     * The caller mails the code: whether an address *should* get an email is a
     * product decision (a password reset for an unknown address must send
     * nothing at all, a signup code always sends), and keeping that decision at
     * the call site is what stops this class from having to know who exists.
     *
     * @return array{status: 'sent'|'cooldown'|'rate_limited', retryAfter: int, code: ?string}
     */
    public static function issue(string $email, string $purpose, ?int $userId = null): array
    {
        $email = self::normalize($email);
        $now = now();

        try {
            $latest = self::query($email, $purpose)->orderByDesc('id')->first();

            if ($latest && $latest->created_at && $latest->created_at->gt($now->copy()->subSeconds(self::COOLDOWN_SECONDS))) {
                $elapsed = $now->getTimestamp() - $latest->created_at->getTimestamp();

                return ['status' => 'cooldown', 'retryAfter' => max(1, self::COOLDOWN_SECONDS - $elapsed), 'code' => null];
            }

            $lastHour = self::query($email, $purpose)
                ->where('created_at', '>=', $now->copy()->subHour())
                ->count();

            if ($lastHour >= self::MAX_PER_HOUR) {
                return ['status' => 'rate_limited', 'retryAfter' => 900, 'code' => null];
            }

            $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);

            EmailCode::create([
                'user_id' => $userId,
                'email' => $email,
                'purpose' => $purpose,
                'code_hash' => self::hash($email, $purpose, $code),
                'attempts' => 0,
                'expires_at' => $now->copy()->addMinutes(self::CODE_TTL_MINUTES),
            ]);

            return ['status' => 'sent', 'retryAfter' => 0, 'code' => $code];
        } catch (\Throwable $e) {
            // Storage not prepared yet, or the insert failed. Reporting "sent"
            // keeps a caller from leaking whether anything happened; the email
            // simply never arrives, and the log says why.
            report($e);

            return ['status' => 'sent', 'retryAfter' => 0, 'code' => null];
        }
    }

    /**
     * Spend a code. True only when it matched, was live and had guesses left.
     */
    public static function verify(string $email, string $purpose, string $code): bool
    {
        $email = self::normalize($email);
        $code = trim($code);

        if ($code === '' || ! ctype_digit($code)) {
            return false;
        }

        try {
            $row = self::query($email, $purpose)->whereNull('used_at')->orderByDesc('id')->first();

            if (! $row || ! $row->expires_at || $row->expires_at->isPast()) {
                return false;
            }

            if ((int) $row->attempts >= self::MAX_ATTEMPTS) {
                return false;
            }

            $row->forceFill(['attempts' => (int) $row->attempts + 1])->save();

            if (! hash_equals((string) $row->code_hash, self::hash($email, $purpose, $code))) {
                return false;
            }

            // One code, one use: burn every outstanding code for this address
            // and purpose.
            self::query($email, $purpose)->whereNull('used_at')->update(['used_at' => now()]);

            return true;
        } catch (\Throwable $e) {
            report($e);

            return false;
        }
    }

    /** How many guesses are left on the live code, for the "wrong code" message. */
    public static function attemptsLeft(string $email, string $purpose): int
    {
        try {
            $row = self::query($email, $purpose)->whereNull('used_at')->orderByDesc('id')->first();

            if (! $row) {
                return 0;
            }

            return max(0, self::MAX_ATTEMPTS - (int) $row->attempts);
        } catch (\Throwable $e) {
            return self::MAX_ATTEMPTS;
        }
    }

    /** Drop this address's outstanding codes — used when the flow finishes. */
    public static function clear(string $email, string $purpose): void
    {
        try {
            self::query($email, $purpose)->whereNull('used_at')->update(['used_at' => now()]);
        } catch (\Throwable $e) {
            // Nothing to clean up.
        }
    }

    /** @return \Illuminate\Database\Eloquent\Builder<EmailCode> */
    private static function query(string $email, string $purpose)
    {
        return EmailCode::query()->where('email', $email)->where('purpose', $purpose);
    }

    private static function normalize(string $email): string
    {
        return strtolower(trim($email));
    }

    /** A digest of purpose + address + digits — never the code itself. */
    private static function hash(string $email, string $purpose, string $code): string
    {
        return hash('sha256', 'futsal-nepal::'.$purpose.'::'.$email.'::'.$code);
    }
}
