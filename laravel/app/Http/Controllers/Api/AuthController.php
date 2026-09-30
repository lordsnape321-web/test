<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Services\EmailCodes;
use App\Services\Mailer;
use App\Support\LegacyPassword;
use App\Support\Validation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Signup, login, password reset and password change.
 *
 * There is no session and no token. The Expo app holds the signed-in `user`
 * object in AsyncStorage and passes `userId` back on requests that need to know
 * who is acting.
 *
 * Signup is two steps and the account does not exist until both are done:
 * `POST /api/auth/signup/code` emails a six-digit code, and `POST
 * /api/auth/signup` carries it back with the rest of the form. An address that
 * nobody can read is not a usable account — it is how you end up with a
 * "customer" you can never reach and a password reset that goes nowhere.
 */
class AuthController extends ApiController
{
    private const AVATAR_COLORS = ['#16a34a', '#2563eb', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4d7c0f'];

    private const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

    private const POSITIONS = ['Striker', 'Midfielder', 'Winger', 'Defender', 'Goalkeeper', 'Pivot', 'All-rounder'];

    /**
     * POST /api/auth/signup/code — email a code to finish creating an account.
     *
     * Unlike a password reset, this endpoint *tells* you when the address is
     * already registered: that is what the person needs to hear at this point
     * ("you already have an account, log in instead"), and it is not a secret —
     * signing up with an address that has an account fails a second later
     * anyway.
     */
    public function signupCode(Request $request): JsonResponse
    {
        $email = strtolower(trim((string) $request->input('email', '')));
        $name = trim((string) $request->input('name', ''));

        $error = Validation::email($email);

        if ($error) {
            return $this->fail($error, 400);
        }

        if (User::where('email', $email)->exists()) {
            return $this->fail('This email is already registered. Please log in instead. 💌', 409);
        }

        $issued = EmailCodes::issue($email, EmailCodes::PURPOSE_SIGNUP);

        if ($issued['status'] === 'cooldown') {
            return $this->fail(
                'A code is already on its way — give it '.$issued['retryAfter'].' seconds, then try again. ⏳',
                429,
                ['retryAfter' => $issued['retryAfter']]
            );
        }

        if ($issued['status'] === 'rate_limited') {
            return $this->fail('Too many codes for this address. Try again in about 15 minutes. 🛑', 429, ['retryAfter' => 900]);
        }

        if ($issued['code'] !== null) {
            self::sendSignupCode($email, $name, $issued['code']);
        }

        return $this->ok([
            'ok' => true,
            'email' => $email,
            'expiresIn' => EmailCodes::CODE_TTL_MINUTES * 60,
        ]);
    }

    /** POST /api/auth/signup */
    public function signup(Request $request): JsonResponse
    {
        $name = trim((string) $request->input('name', ''));
        $email = strtolower(trim((string) $request->input('email', '')));
        $phone = Validation::normalizePhone($request->input('phone'));
        $password = (string) $request->input('password', '');
        $role = $request->input('role') === 'owner' ? 'owner' : 'player';
        $defaultCity = trim((string) $request->input('defaultCity', 'All Cities'));
        $avatarUrl = trim((string) $request->input('avatarUrl', ''));

        $error = Validation::firstError(
            Validation::name($name),
            Validation::email($email),
            Validation::phone($phone, ['required' => true]),
            Validation::password($password),
            $request->has('defaultCity') ? Validation::city($defaultCity, 'Home city') : null,
            $avatarUrl !== '' ? Validation::avatarUrl($avatarUrl) : null,
        );

        if ($error) {
            return $this->fail($error, 400);
        }

        if ($role !== 'owner') {
            if ($request->filled('level') && ! in_array((string) $request->input('level'), self::LEVELS, true)) {
                return $this->fail('Pick a valid level 🌱⚡🔥', 400);
            }

            if ($request->filled('position') && ! in_array((string) $request->input('position'), self::POSITIONS, true)) {
                return $this->fail('Pick a valid position ⚽', 400);
            }
        }

        if (User::where('email', $email)->exists()) {
            return $this->fail('This email is already registered. Please log in instead. 💌', 409);
        }

        if (User::where('phone', $phone)->exists()) {
            return $this->fail('This phone number is already registered. Please log in instead. 📱', 409);
        }

        // The address has to be proven before the account exists. Checked after
        // the cheap uniqueness rules so "that email is taken" is still the first
        // thing someone hears, and before the insert so a wrong code leaves no
        // half-made account behind.
        $code = trim((string) $request->input('code', ''));

        if ($code === '') {
            return $this->fail('Enter the 6-digit code we emailed you to finish signing up ✉️', 400, ['needsCode' => true]);
        }

        if (! EmailCodes::verify($email, EmailCodes::PURPOSE_SIGNUP, $code)) {
            $left = EmailCodes::attemptsLeft($email, EmailCodes::PURPOSE_SIGNUP);

            return $this->fail(
                $left > 0
                    ? "That code doesn't match. {$left} ".( $left === 1 ? 'try' : 'tries').' left.'
                    : 'That code has expired or run out of tries. Send a fresh one. 🔁',
                401
            );
        }

        $user = User::create([
            'name' => $name,
            'email' => $email,
            'phone' => $phone,
            'password_hash' => LegacyPassword::hash($password),
            'role' => $role,
            'avatar_color' => self::AVATAR_COLORS[array_rand(self::AVATAR_COLORS)],
            'avatar_url' => mb_substr($avatarUrl, 0, 2000000),
            'default_city' => $defaultCity,
            'level' => $role === 'owner' ? '—' : (string) $request->input('level', 'Intermediate'),
            'position' => $role === 'owner' ? 'Owner' : (string) $request->input('position', 'All-rounder'),
        ]);

        self::sendWelcome($user);

        return $this->ok(['user' => $user->toArray()], 201);
    }

    /** POST /api/auth/login */
    public function login(Request $request): JsonResponse
    {
        $email = strtolower(trim((string) $request->input('email', '')));
        $password = (string) $request->input('password', '');

        $error = Validation::firstError(
            Validation::email($email),
            $password === '' ? 'Password is required 🔒' : (mb_strlen($password) > 100 ? 'Password is too long' : null),
        );

        if ($error) {
            return $this->fail($error, 400);
        }

        $account = User::where('email', $email)->first();

        if (! $account) {
            return $this->fail('No account found with this email. Please sign up. 🌱', 404);
        }

        // An account created before passwords existed gets its first password
        // set here, so login works instead of demanding a reset.
        if ($account->password_hash === '' || $account->password_hash === null) {
            $account->forceFill(['password_hash' => LegacyPassword::hash($password)])->save();

            return $this->ok(['user' => $account->fresh()->toArray()]);
        }

        if (! LegacyPassword::verify($password, $account->password_hash)) {
            return $this->fail('Incorrect password. Try again — or reset it! 🔑', 401);
        }

        return $this->ok(['user' => $account->toArray()]);
    }

    /**
     * POST /api/auth/reset — set a new password using email + phone as proof.
     */
    public function reset(Request $request): JsonResponse
    {
        $email = strtolower(trim((string) $request->input('email', '')));
        $phone = Validation::normalizePhone($request->input('phone'));
        $newPassword = (string) $request->input('newPassword', '');

        $error = Validation::firstError(
            Validation::email($email),
            Validation::phone($phone, ['required' => true]),
            Validation::password($newPassword, ['label' => 'New password']),
        );

        if ($error) {
            return $this->fail($error, 400);
        }

        $account = User::where('email', $email)->first();

        if (! $account) {
            return $this->fail('No account found with this email. 🌱', 404);
        }

        if ($account->phone !== $phone) {
            return $this->fail('That phone number doesn’t match this account. 📱', 401);
        }

        $account->forceFill(['password_hash' => LegacyPassword::hash($newPassword)])->save();
        self::sendPasswordChanged($account, 'reset');

        return $this->ok(['ok' => true]);
    }

    /**
     * POST /api/auth/forgot-password — email a six-digit reset code.
     *
     * Always answers with the same shape, whether or not the address has an
     * account: this endpoint must not be a way to find out who is registered.
     */
    public function forgotPassword(Request $request): JsonResponse
    {
        $email = strtolower(trim((string) $request->input('email', '')));
        $error = Validation::email($email);

        if ($error) {
            return $this->fail($error, 400);
        }

        $result = EmailCodes::issue($email, EmailCodes::PURPOSE_PASSWORD_RESET, User::where('email', $email)->value('id'));

        if ($result['status'] === 'cooldown') {
            return $this->fail(
                'A code is already on its way — give it '.$result['retryAfter'].' seconds, then try again. ⏳',
                429
            );
        }

        if ($result['status'] === 'rate_limited') {
            return $this->fail('Too many codes for this address. Try again in about 15 minutes. 🛑', 429);
        }

        // Written for a known and an unknown address alike (the row exists
        // either way); only a real account gets an email. That is what keeps
        // this endpoint from answering "does this person have an account?".
        if ($result['code'] !== null) {
            $account = User::where('email', $email)->first();

            if ($account) {
                self::sendResetCode($account, $result['code']);
            }
        }

        return $this->ok([
            'ok' => true,
            // The screen shows this so people check the right inbox.
            'email' => $email,
        ]);
    }

    /**
     * POST /api/auth/reset-with-code — the emailed code plus a new password.
     */
    public function resetWithCode(Request $request): JsonResponse
    {
        $email = strtolower(trim((string) $request->input('email', '')));
        $code = trim((string) $request->input('code', ''));
        $newPassword = (string) $request->input('newPassword', '');

        $error = Validation::firstError(
            Validation::email($email),
            $code === '' ? 'Enter the 6-digit code from your email 🔑' : null,
            Validation::password($newPassword, ['label' => 'New password']),
        );

        if ($error) {
            return $this->fail($error, 400);
        }

        // Verify before revealing whether the address exists, so a wrong code and
        // an unknown address look the same from the outside.
        if (! EmailCodes::verify($email, EmailCodes::PURPOSE_PASSWORD_RESET, $code)) {
            $left = EmailCodes::attemptsLeft($email, EmailCodes::PURPOSE_PASSWORD_RESET);

            return $this->fail(
                $left > 0
                    ? "That code doesn't match. {$left} ".( $left === 1 ? 'try' : 'tries').' left.'
                    : 'That code has expired or run out of tries. Request a fresh one. 🔁',
                401
            );
        }

        $account = User::where('email', $email)->first();

        if (! $account) {
            return $this->fail('No account found with this email. 🌱', 404);
        }

        $account->forceFill(['password_hash' => LegacyPassword::hash($newPassword)])->save();
        self::sendPasswordChanged($account, 'code');

        return $this->ok(['ok' => true]);
    }

    /** POST /api/auth/change-password */
    public function changePassword(Request $request): JsonResponse
    {
        $userId = (int) $request->input('userId', 0);
        $current = (string) $request->input('currentPassword', '');
        $new = (string) $request->input('newPassword', '');

        if ($userId <= 0) {
            return $this->fail('Valid login required 🔒', 400);
        }

        $error = Validation::firstError(
            $current === '' ? 'Current password is required 🔒' : null,
            Validation::password($new, ['label' => 'New password']),
        );

        if ($error) {
            return $this->fail($error, 400);
        }

        if ($current === $new) {
            return $this->fail('New password must be different from the old one 🔄', 400);
        }

        $account = User::find($userId);

        if (! $account) {
            return $this->fail('User not found', 404);
        }

        if (! LegacyPassword::verify($current, $account->password_hash)) {
            return $this->fail('Current password is incorrect 🔒', 401);
        }

        $account->forceFill(['password_hash' => LegacyPassword::hash($new)])->save();
        self::sendPasswordChanged($account, 'changed');

        return $this->ok(['ok' => true]);
    }

    /** The "welcome to the club" note, sent once the account exists. */
    private static function sendWelcome(User $user): void
    {
        $isOwner = $user->role === 'owner';

        Mailer::queueForUser($user, $isOwner ? 'Welcome aboard 🏟️' : 'Welcome to the family ⚽', [
            'type' => 'welcome',
            'eyebrow' => $isOwner ? 'Owner account' : 'Player account',
            'heading' => $isOwner ? 'Your venue, your rules 🏟️' : 'You are in! ⚽',
            'preheader' => 'Here is what you can do next.',
            'intro' => $isOwner
                ? [
                    'Your owner account is ready. Add your venue from Owner Studio, set each court and its opening hours, and booking requests will land in your inbox.',
                ]
                : [
                    'Your account is ready. Find a court near you, book a slot, and split the cost with your squad from the booking screen.',
                    'We will email you when a booking is confirmed and a couple of hours before kick-off.',
                ],
            'rows' => [
                'Account' => (string) $user->email,
                'Home city' => (string) ($user->default_city ?: 'All Cities'),
            ],
            'footnote' => 'Prefer fewer emails? Turn them off any time in Settings → Alerts → Email.',
        ], 'always');
    }

    /**
     * The six digits that finish a signup.
     *
     * Sent to an address that has no account yet, so there is no `User` to hand
     * to `Mailer::queueForUser` — this is the one email in the app addressed to
     * a stranger, and it says what they are being asked to confirm.
     */
    private static function sendSignupCode(string $email, string $name, string $code): void
    {
        Mailer::queue([
            'to' => $email,
            'name' => $name,
            'subject' => 'Your Futsal Nepal code: '.$code,
            'type' => 'signup',
            'payload' => [
                'type' => 'signup',
                'eyebrow' => 'Finish signing up',
                'heading' => 'Confirm your email',
                'preheader' => 'Type this code in the app to create your account.',
                'intro' => [
                    $name !== ''
                        ? "Welcome, {$name}! One step left: type the code below into the app and your account is ready."
                        : 'Welcome! One step left: type the code below into the app and your account is ready.',
                ],
                'code' => $code,
                'rows' => ['Valid for' => EmailCodes::CODE_TTL_MINUTES.' minutes'],
                'footnote' => 'Didn’t sign up? Ignore this email — no account is created without the code, and nothing else will be sent to this address.',
            ],
        ]);
    }

    /** The six digits that reset a password. */
    private static function sendResetCode(User $account, string $code): void
    {
        Mailer::queueForUser($account, 'Your password reset code 🔑', [
            'type' => 'password',
            'eyebrow' => 'Password reset',
            'heading' => 'Your reset code',
            'preheader' => 'Use this code to set a new password. It expires in 15 minutes.',
            'intro' => [
                'Someone asked to reset the password for this account. Type the code below into the app, then choose a new password.',
            ],
            'code' => $code,
            'rows' => ['Valid for' => EmailCodes::CODE_TTL_MINUTES.' minutes'],
            'footnote' => 'Didn’t ask for this? You can ignore this email — your password stays exactly as it is until the code is used.',
        ], 'always');
    }

    /**
     * Tell the account owner their password changed.
     *
     * `$source` is what triggered it, so the wording stays accurate: an emailed
     * code, the phone-verified reset, or a change from inside the app.
     */
    private static function sendPasswordChanged(User $user, string $source): void
    {
        $how = match ($source) {
            'code' => 'using a code from your email',
            'changed' => 'from your account settings',
            default => 'using your email and phone number',
        };

        Mailer::queueForUser($user, 'Your password was changed 🔐', [
            'type' => 'password',
            'eyebrow' => 'Account security',
            'heading' => 'Password changed',
            'preheader' => 'This is the receipt for your password change.',
            'intro' => [
                "The password on your account was just changed {$how}.",
                'If that was you, nothing else to do. If it was not, reset your password now — this email is the only receipt you will get.',
            ],
            'rows' => [
                'Account' => (string) $user->email,
                'When' => now()->format('D, j M Y g:i A'),
            ],
        ], 'always');
    }
}
