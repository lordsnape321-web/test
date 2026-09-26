<?php

namespace App\Support;

/**
 * The password hash the Next.js API used.
 *
 * Every account on the platform was created with
 * `sha256("futsal-nepal::auth-v1::" . password)`, so moving the backend to
 * Laravel must not silently re-hash everybody: `Hash::make()` would store a
 * bcrypt string in the same column and every existing player would be locked
 * out of their account the moment the new API went live.
 *
 * New passwords are written with the same function for the same reason — the
 * column holds one format, and login only has to try one.
 */
class LegacyPassword
{
    private const SALT = 'futsal-nepal::auth-v1';

    public static function hash(string $password): string
    {
        return hash('sha256', self::SALT.'::'.$password);
    }

    public static function verify(string $password, ?string $hash): bool
    {
        if (! $hash || $hash === '') {
            return false;
        }

        return hash_equals(self::hash($password), $hash);
    }
}
