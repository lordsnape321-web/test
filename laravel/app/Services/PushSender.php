<?php

namespace App\Services;

use App\Models\PushToken;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Push notifications — the transport behind `Notifier`.
 *
 * `Notifier` is the single funnel every message in the product already goes
 * through (bell row + optional email). This is the third leg: the same message
 * delivered to the phones that asked for it, so a player who closed the app
 * still learns their booking was accepted.
 *
 * Two things are deliberate:
 *
 *   • **It never throws and it never blocks a request.** A push that fails is a
 *     notification missing, not a booking failing. Every path here swallows and
 *     reports, like `Notifier::email()` does.
 *   • **It is silent until it is configured.** No tokens means no HTTP call, so
 *     a fresh install of the backend behaves exactly as it did before — the
 *     moment a phone registers, pushes start. That keeps the whole feature
 *     shippable before any Expo account exists.
 *
 * Expo's service is the transport because the app is an Expo app: one POST to
 * `https://exp.host/--/api/v2/push/send` fans out to FCM and APNs, so there is
 * no Firebase server key in this repository. `EXPO_PUSH_URL` overrides it for
 * tests.
 */
class PushSender
{
    /** Expo accepts at most 100 messages per request. */
    private const BATCH = 100;

    /**
     * Deliver one notification to every phone this account is signed in on.
     *
     * @param  array{link?: string, type?: string}  $extra  Routed to the app on tap.
     * @return int  How many messages Expo accepted (0 when nothing was sent).
     */
    public static function send(int $userId, string $title, string $body = '', array $extra = []): int
    {
        try {
            $user = User::find($userId);

            if (! $user) {
                return 0;
            }

            // The account switch is checked here rather than at the call sites:
            // every notification in the product flows through `Notifier`, and a
            // rule about who wants to be buzzed belongs in one place.
            if (! $user->wantsPush()) {
                return 0;
            }

            $tokens = PushToken::where('user_id', $userId)->pluck('token')->all();

            if ($tokens === []) {
                return 0;
            }

            $sent = 0;

            foreach (array_chunk($tokens, self::BATCH) as $chunk) {
                $sent += self::post($chunk, $title, $body, $extra);
            }

            return $sent;
        } catch (Throwable $e) {
            report($e);

            return 0;
        }
    }

    /**
     * One batch to Expo. Returns how many messages it accepted.
     *
     * @param  list<string>  $tokens
     * @param  array{link?: string, type?: string}  $extra
     */
    private static function post(array $tokens, string $title, string $body, array $extra): int
    {
        $messages = array_map(fn (string $token) => [
            'to' => $token,
            'title' => $title,
            'body' => $body,
            'sound' => 'default',
            // Expo treats these as the tap payload; the app routes on `link`,
            // which is the same in-app route the bell row carries.
            'data' => $extra,
        ], $tokens);

        $response = Http::timeout(10)
            ->acceptJson()
            ->post(self::endpoint(), $messages);

        if (! $response->successful()) {
            report(new \RuntimeException('Expo push failed with HTTP '.$response->status()));

            return 0;
        }

        $tickets = $response->json('data');

        if (! is_array($tickets)) {
            return 0;
        }

        $accepted = 0;

        foreach ($tickets as $i => $ticket) {
            if (($ticket['status'] ?? '') === 'ok') {
                $accepted++;

                continue;
            }

            // `DeviceNotRegistered` is Expo saying this token is dead — the app
            // was uninstalled, or the token rotated. Keeping it would mean
            // trying again on every future notification, so it goes.
            if (($ticket['details']['error'] ?? '') === 'DeviceNotRegistered' && isset($tokens[$i])) {
                PushToken::where('token', $tokens[$i])->delete();
            }
        }

        return $accepted;
    }

    private static function endpoint(): string
    {
        return (string) config('services.expo.push_url', 'https://exp.host/--/api/v2/push/send');
    }

    /**
     * Remember a phone, or refresh a row we already have.
     *
     * Called on every app launch, so it must be idempotent: the same token
     * arriving twice updates `last_seen_at` and the device label instead of
     * inserting a second row.
     */
    public static function register(int $userId, string $token, string $platform = 'android', string $deviceName = ''): PushToken
    {
        return PushToken::updateOrCreate(
            ['token' => $token],
            [
                'user_id' => $userId,
                'platform' => in_array($platform, ['android', 'ios', 'web'], true) ? $platform : 'android',
                'device_name' => mb_substr($deviceName, 0, 120),
                'last_seen_at' => now(),
            ]
        );
    }

    /** Signing out (or switching push off) forgets the phone. */
    public static function forget(string $token): void
    {
        PushToken::where('token', $token)->delete();
    }
}
