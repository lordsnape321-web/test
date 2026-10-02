<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\User;
use App\Services\AccountDeletion;
use App\Services\EmailCodes;
use App\Services\Mailer;
use App\Support\Loyalty;
use App\Support\Validation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UserController extends ApiController
{
    private const LEVELS = ['Beginner', 'Intermediate', 'Advanced', '—'];

    private const POSITIONS = ['Striker', 'Midfielder', 'Winger', 'Defender', 'Goalkeeper', 'Pivot', 'All-rounder', 'Owner'];

    private const COLORS = ['#16a34a', '#2563eb', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4d7c0f', '#f59e0b'];

    /**
     * GET /api/users
     *
     * `?q=` narrows by name or email (the captain's invite search box) and
     * `?role=player` returns the only list a squad may recruit from. Owners run
     * courts and admins run the platform, so neither belongs in a roster —
     * filtering here means a UI tweak cannot quietly put staff accounts back in
     * front of a captain.
     */
    public function index(Request $request): JsonResponse
    {
        $q = mb_strtolower(trim((string) $request->query('q', '')));
        $role = mb_strtolower(trim((string) $request->query('role', '')));

        $query = User::query();

        if ($q !== '') {
            $query->where(function ($sub) use ($q) {
                $sub->whereRaw('LOWER(name) LIKE ?', ['%'.$q.'%'])
                    ->orWhereRaw('LOWER(email) LIKE ?', ['%'.$q.'%']);
            });
        }

        if ($role !== '') {
            $query->whereRaw('LOWER(role) = ?', [$role]);
        }

        return $this->ok([
            'users' => $query->orderBy('id')->get()->toArray(),
            'query' => $q,
            'role' => $role,
        ]);
    }

    /** GET /api/users/{id} — the profile plus the reliability card. */
    public function show(int $id): JsonResponse
    {
        $user = User::find($id);

        if (! $user) {
            return $this->fail('User not found', 404);
        }

        $history = Booking::where('user_id', $id)->get(['status', 'created_at'])->toArray();
        $stats = Loyalty::playerRating($history, now(), (int) $user->trust_score);

        return $this->ok(['user' => $user->toArray(), 'stats' => $stats]);
    }

    /** PATCH /api/users/{id} */
    public function update(Request $request, int $id): JsonResponse
    {
        $user = User::find($id);

        if (! $user) {
            return $this->fail('User not found', 404);
        }

        $patch = [];

        if ($request->has('name')) {
            $error = Validation::name($request->input('name'));

            if ($error) {
                return $this->fail($error, 400);
            }

            $patch['name'] = trim((string) $request->input('name'));
        }

        if ($request->has('phone')) {
            $phone = Validation::normalizePhone($request->input('phone'));
            $error = Validation::phone($phone, ['required' => true]);

            if ($error) {
                return $this->fail($error, 400);
            }

            $taken = User::where('phone', $phone)->where('id', '!=', $id)->exists();

            if ($taken) {
                return $this->fail('This phone number is already used by another account. 📱', 409);
            }

            $patch['phone'] = $phone;
        }

        if ($request->has('avatarColor')) {
            $color = (string) $request->input('avatarColor');

            if (! in_array($color, self::COLORS, true) && ! preg_match('/^#[0-9a-fA-F]{6}$/', $color)) {
                return $this->fail('Pick a valid avatar colour 🎨', 400);
            }

            $patch['avatar_color'] = $color;
        }

        if ($request->has('level')) {
            $level = (string) $request->input('level');

            if (! in_array($level, self::LEVELS, true)) {
                return $this->fail('Pick a valid level 🌱⚡🔥', 400);
            }

            $patch['level'] = $level;
        }

        if ($request->has('position')) {
            $position = (string) $request->input('position');

            if (! in_array($position, self::POSITIONS, true)) {
                return $this->fail('Pick a valid position ⚽', 400);
            }

            $patch['position'] = $position;
        }

        if ($request->has('avatarUrl')) {
            $avatarUrl = (string) $request->input('avatarUrl');
            $error = Validation::avatarUrl($avatarUrl);

            if ($error) {
                return $this->fail($error, 400);
            }

            $patch['avatar_url'] = mb_substr(trim($avatarUrl), 0, 2000000);
        }

        if ($request->has('defaultCity')) {
            $defaultCity = (string) $request->input('defaultCity');
            $error = Validation::city($defaultCity, 'Home city');

            if ($error) {
                return $this->fail($error, 400);
            }

            $patch['default_city'] = trim($defaultCity);
        }

        // Email switches, set from Settings → Alerts → Email. `notify` keeps the
        // wording of the API: booleans only, no truthy strings.
        if ($request->has('emailNotifications')) {
            $patch['email_notifications'] = filter_var($request->input('emailNotifications'), FILTER_VALIDATE_BOOLEAN);
        }

        if ($request->has('emailReminders')) {
            $patch['email_reminders'] = filter_var($request->input('emailReminders'), FILTER_VALIDATE_BOOLEAN);
        }

        if ($request->has('reminderMinutes')) {
            $minutes = (int) $request->input('reminderMinutes');

            if ($minutes < 15 || $minutes > 1440) {
                return $this->fail('Remind me between 15 minutes and 24 hours before kick-off ⏰', 400);
            }

            $patch['reminder_minutes'] = $minutes;
        }

        if ($patch !== []) {
            $user->forceFill($patch)->save();
        }

        return $this->ok(['user' => $user->fresh()->toArray()]);
    }

    /**
     * POST /api/users/{id}/delete-code — email the code that closes an account.
     *
     * Closing an account is irreversible, so it takes something only the account
     * holder has: their inbox. The code goes to the address on the account, not
     * to any address in the request — otherwise knowing a user id would be
     * enough to ask for somebody else's confirmation code.
     *
     * There is no separate "are you sure?" state on the server. The client asks;
     * the code is the confirmation.
     */
    public function sendDeleteCode(Request $request, int $id): JsonResponse
    {
        $user = User::find($id);

        if (! $user) {
            return $this->fail('Account not found 🌱', 404);
        }

        $issued = EmailCodes::issue((string) $user->email, EmailCodes::PURPOSE_ACCOUNT_DELETE, (int) $user->id);

        if ($issued['status'] === 'cooldown') {
            return $this->fail(
                'A code is already on its way — give it '.$issued['retryAfter'].' seconds, then try again. ⏳',
                429,
                ['retryAfter' => $issued['retryAfter']]
            );
        }

        if ($issued['status'] === 'rate_limited') {
            return $this->fail('Too many codes for this account. Try again in about 15 minutes. 🛑', 429, ['retryAfter' => 900]);
        }

        if ($issued['code'] !== null) {
            self::emailDeleteCode($user, $issued['code']);
        }

        return $this->ok([
            'ok' => true,
            // Masked, so the screen can show which inbox to check without the
            // app having to read the account's email out loud.
            'email' => self::maskEmail((string) $user->email),
            'expiresIn' => EmailCodes::CODE_TTL_MINUTES * 60,
        ]);
    }

    /**
     * DELETE /api/users/{id} — close the account, with the emailed code as proof.
     */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $user = User::find($id);

        if (! $user) {
            return $this->fail('Account not found 🌱', 404);
        }

        $code = trim((string) $request->input('code', ''));

        if ($code === '') {
            return $this->fail('Enter the 6-digit code we emailed you to confirm ✉️', 400, ['needsCode' => true]);
        }

        // Verified against the address on the account, which is the only one the
        // code was ever sent to.
        if (! EmailCodes::verify((string) $user->email, EmailCodes::PURPOSE_ACCOUNT_DELETE, $code)) {
            $left = EmailCodes::attemptsLeft((string) $user->email, EmailCodes::PURPOSE_ACCOUNT_DELETE);

            return $this->fail(
                $left > 0
                    ? "That code doesn't match. {$left} ".( $left === 1 ? 'try' : 'tries').' left.'
                    : 'That code has expired or run out of tries. Send a fresh one. 🔁',
                401
            );
        }

        $email = (string) $user->email;

        if (! AccountDeletion::close($user)) {
            return $this->fail('This account is already closed. 🌱', 409);
        }

        EmailCodes::clear($email, EmailCodes::PURPOSE_ACCOUNT_DELETE);

        // Deliberately no "goodbye" email here: the address is gone by now, and
        // nothing may be sent to it again. The receipt, if someone wants one,
        // is the code email they already have.
        return $this->ok(['ok' => true, 'closed' => true]);
    }

    /** "someone@example.com" → "s•••@example.com". */
    public static function maskEmail(string $email): string
    {
        [$local, $domain] = array_pad(explode('@', $email, 2), 2, '');

        if ($domain === '') {
            return '•••';
        }

        return mb_substr($local, 0, 1).'•••@'.$domain;
    }

    private static function emailDeleteCode(User $user, string $code): void
    {
        Mailer::queueForUser($user, 'Your account deletion code ⚠️', [
            'type' => 'account',
            'eyebrow' => 'Account deletion',
            'heading' => 'Confirm account deletion',
            'preheader' => 'Type this code in the app to close your account.',
            'intro' => [
                'Someone asked to close this Futsal Mate account. Type the code below in the app to confirm.',
                'This cannot be undone: your profile, your team memberships and your pending bookings are removed, and you will not be able to log in again.',
            ],
            'code' => $code,
            'rows' => [
                'Account' => (string) $user->email,
                'Valid for' => EmailCodes::CODE_TTL_MINUTES.' minutes',
            ],
            'footnote' => 'If this was not you, do nothing: without the code the account stays exactly as it is. Consider changing your password if you are not sure.',
        ], 'always');
    }
}
