<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Support\LegacyPassword;
use App\Support\Validation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Signup, login, password reset and password change.
 *
 * There is no session and no token — exactly as the Next.js API had it. The app
 * holds the signed-in `user` object in AsyncStorage and passes `userId` back on
 * the requests that need to know who is acting. See docs/authentication.md.
 */
class AuthController extends ApiController
{
    private const AVATAR_COLORS = ['#16a34a', '#2563eb', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4d7c0f'];

    private const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

    private const POSITIONS = ['Striker', 'Midfielder', 'Winger', 'Defender', 'Goalkeeper', 'Pivot', 'All-rounder'];

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

        return $this->ok(['ok' => true]);
    }
}
