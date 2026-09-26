<?php

namespace App\Http\Controllers\Api;

use App\Models\Booking;
use App\Models\User;
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

        if ($patch !== []) {
            $user->forceFill($patch)->save();
        }

        return $this->ok(['user' => $user->fresh()->toArray()]);
    }
}
