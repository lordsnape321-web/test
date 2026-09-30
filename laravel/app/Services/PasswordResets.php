<?php

namespace App\Services;

use App\Models\PasswordResetCode;
use App\Models\User;

/**
 * "Forgot your password?" — the email-code half of it.
 *
 * The app already had a reset that proved ownership with the registered phone
 * number. This is the path people expect: type your email, get a six-digit code,
 * type the code with a new password. No deep links, no reset URL that has to
 * land back in a native app — the code works whatever device the inbox is on.
 *
 * Rules, all enforced here so both endpoints agree:
 *   • a code lives for 15 minutes,
 *   • five wrong guesses and it is dead,
 *   • five codes an hour per address, one a minute,
 *   • a code can only be spent once, and spending it kills its siblings.
 */
class PasswordResets
{
    public const CODE_TTL_MINUTES = 15;

    public const MAX_ATTEMPTS = 5;

    public const MAX_PER_HOUR = 5;

    public const COOLDOWN_SECONDS = 60;

    /**
     * Create and email a code.
     *
     * Returns `sent`, or `cooldown` / `rate_limited` with the seconds to wait —
     * the caller turns that into a friendly message. An unknown address still
     * reports `sent`, so this endpoint cannot be used to find out who has an
     * account; the row is written either way (to keep the timing honest) but no
     * email is queued for it.
     *
     * @return array{status: 'sent'|'cooldown'|'rate_limited', retryAfter: int}
     */
    public static function issue(string $email): array
    {
        $email = strtolower(trim($email));
        $now = now();

        try {
            $latest = PasswordResetCode::where('email', $email)->orderByDesc('id')->first();

            if ($latest && $latest->created_at && $latest->created_at->gt($now->copy()->subSeconds(self::COOLDOWN_SECONDS))) {
                $elapsed = $now->getTimestamp() - $latest->created_at->getTimestamp();

                return ['status' => 'cooldown', 'retryAfter' => max(1, self::COOLDOWN_SECONDS - $elapsed)];
            }

            $lastHour = PasswordResetCode::where('email', $email)
                ->where('created_at', '>=', $now->copy()->subHour())
                ->count();

            if ($lastHour >= self::MAX_PER_HOUR) {
                return ['status' => 'rate_limited', 'retryAfter' => 900];
            }

            $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            $user = User::where('email', $email)->first();

            PasswordResetCode::create([
                'user_id' => $user?->id,
                'email' => $email,
                'code_hash' => self::hash($email, $code),
                'attempts' => 0,
                'expires_at' => $now->copy()->addMinutes(self::CODE_TTL_MINUTES),
            ]);

            if ($user) {
                Mailer::queueForUser($user, 'Your password reset code 🔑', [
                    'type' => 'password',
                    'eyebrow' => 'Password reset',
                    'heading' => 'Your reset code',
                    'preheader' => 'Use this code to set a new password. It expires in 15 minutes.',
                    'intro' => [
                        'Someone asked to reset the password for this account. Type the code below into the app, then choose a new password.',
                    ],
                    'code' => $code,
                    'rows' => ['Valid for' => self::CODE_TTL_MINUTES.' minutes'],
                    'footnote' => 'Didn’t ask for this? You can ignore this email — your password stays exactly as it is until the code is used.',
                ], 'always');
            }
        } catch (\Throwable $e) {
            report($e);

            return ['status' => 'sent', 'retryAfter' => 0];
        }

        return ['status' => 'sent', 'retryAfter' => 0];
    }

    /**
     * Spend a code. True only when it matched, was live and had guesses left.
     */
    public static function verify(string $email, string $code): bool
    {
        $email = strtolower(trim($email));
        $code = trim($code);

        if ($code === '' || ! ctype_digit($code)) {
            return false;
        }

        try {
            $row = PasswordResetCode::where('email', $email)
                ->whereNull('used_at')
                ->orderByDesc('id')
                ->first();

            if (! $row || ! $row->expires_at || $row->expires_at->isPast()) {
                return false;
            }

            if ((int) $row->attempts >= self::MAX_ATTEMPTS) {
                return false;
            }

            $row->forceFill(['attempts' => (int) $row->attempts + 1])->save();

            if (! hash_equals((string) $row->code_hash, self::hash($email, $code))) {
                return false;
            }

            // One code, one use: burn every outstanding code for this address.
            PasswordResetCode::where('email', $email)->whereNull('used_at')->update(['used_at' => now()]);

            return true;
        } catch (\Throwable $e) {
            report($e);

            return false;
        }
    }

    /** How many guesses are left on the live code, for the "wrong code" message. */
    public static function attemptsLeft(string $email): int
    {
        try {
            $row = PasswordResetCode::where('email', strtolower(trim($email)))
                ->whereNull('used_at')
                ->orderByDesc('id')
                ->first();

            if (! $row) {
                return 0;
            }

            return max(0, self::MAX_ATTEMPTS - (int) $row->attempts);
        } catch (\Throwable $e) {
            return self::MAX_ATTEMPTS;
        }
    }

    /** Codes are stored as a digest of address + digits, never in the clear. */
    private static function hash(string $email, string $code): string
    {
        return hash('sha256', 'futsal-nepal::reset::'.$email.'::'.$code);
    }
}
