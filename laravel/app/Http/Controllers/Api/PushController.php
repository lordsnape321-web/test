<?php

namespace App\Http\Controllers\Api;

use App\Models\PushToken;
use App\Models\User;
use App\Services\PushSender;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The phone's side of push notifications.
 *
 * The app asks for permission, gets an Expo token, and hands it here — on every
 * launch, because tokens rotate and an uninstall/reinstall makes a new one. That
 * call is idempotent by design (`PushSender::register` upserts on the token), so
 * the app never has to reason about whether it already registered.
 *
 * There is no "send a test push" route: the bell is the source of truth, and a
 * player who wants to know whether push works should get a real notification.
 * `status` exists so the app (and a human with curl) can tell the difference
 * between "this phone is registered" and "nothing ever registered" — the two
 * failures look identical from the outside otherwise.
 */
class PushController extends ApiController
{
    /** POST /api/push/register — remember this handset. */
    public function register(Request $request): JsonResponse
    {
        $userId = (int) $request->input('userId', 0);
        $token = $this->text($request->input('token'), 191);

        if ($userId <= 0 || ! User::find($userId)) {
            return $this->fail('Sign in again to turn on notifications 🔔', 401);
        }

        if ($token === '') {
            return $this->fail('That device did not return a notification token', 400);
        }

        $row = PushSender::register(
            $userId,
            $token,
            (string) $request->input('platform', 'android'),
            (string) $request->input('deviceName', '')
        );

        return $this->ok([
            'registered' => true,
            'platform' => $row->platform,
            'devices' => PushToken::where('user_id', $userId)->count(),
        ]);
    }

    /** POST /api/push/unregister — signing out, or the switch went off. */
    public function unregister(Request $request): JsonResponse
    {
        $token = $this->text($request->input('token'), 191);

        if ($token === '') {
            return $this->fail('Which device should stop receiving notifications?', 400);
        }

        PushSender::forget($token);

        return $this->ok(['registered' => false]);
    }

    /** GET /api/push/status?userId= — is anything listening for this account? */
    public function status(Request $request): JsonResponse
    {
        $userId = (int) $request->query('userId', 0);

        if ($userId <= 0) {
            return $this->fail('A userId is required', 400);
        }

        $user = User::find($userId);

        if (! $user) {
            return $this->fail('No such account', 404);
        }

        $devices = PushToken::where('user_id', $userId)->orderByDesc('last_seen_at')->get();

        return $this->ok([
            'enabled' => $user->wantsPush(),
            'devices' => $devices->count(),
            'tokens' => $devices->map(fn (PushToken $t) => [
                'platform' => $t->platform,
                'deviceName' => $t->device_name,
                'lastSeenAt' => $t->last_seen_at,
            ])->all(),
        ]);
    }
}
