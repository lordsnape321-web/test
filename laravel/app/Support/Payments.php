<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Test-gateway plumbing for eSewa and Khalti — `src/lib/payments.ts`.
 *
 * Both gateways are only reachable in their sandbox here, so the credentials
 * default to the public test values and the sandbox URLs; production values
 * come from the environment when they exist.
 */
class Payments
{
    public const ESEWA_TEST_PRODUCT_CODE = 'EPAYTEST';

    public const ESEWA_TEST_SECRET = '8gBm/:&EnhH.1/q';

    public const ESEWA_FORM_URL_DEFAULT = 'https://rc-epay.esewa.com.np/api/epay/main/v2/form';

    public const ESEWA_STATUS_URL_DEFAULT = 'https://rc-epay.esewa.com.np/api/epay/transaction/status/';

    public const KHALTI_INITIATE_URL_DEFAULT = 'https://dev.khalti.com/api/v2/epayment/initiate/';

    public const KHALTI_LOOKUP_URL_DEFAULT = 'https://dev.khalti.com/api/v2/epayment/lookup/';

    /**
     * Khalti's published sandbox merchant key.
     *
     * Khalti prints this key in its own Web Checkout documentation for the test
     * environment, the same way eSewa publishes `EPAYTEST` and the sandbox
     * secret — which is what makes the real test server reachable from a fresh
     * clone with nothing to sign up for. `KHALTI_SECRET_KEY` overrides it with
     * your own merchant key from test-admin.khalti.com (OTP 987654), and if
     * Khalti ever retires this one the initiate call fails and the controller
     * falls back to the local simulator with `fallback: true` rather than
     * breaking the checkout.
     */
    public const KHALTI_TEST_SECRET = 'live_secret_key_68791341fdd94846a146f0457ff7b455';

    /**
     * eSewa's published test logins (developer.esewa.com.np).
     *
     * Not secrets — they are printed in the docs so a merchant can finish a UAT
     * checkout. They are shown on the hand-off page so nobody has to go looking
     * for them mid-payment.
     *
     * @return array{id: string, password: string, mpin: string, token: string}
     */
    public static function esewaTestLogin(): array
    {
        return ['id' => '9806800001', 'password' => 'Nepal@123', 'mpin' => '1122', 'token' => '123456'];
    }

    /** Khalti's published sandbox payer (docs.khalti.com). */
    public static function khaltiTestLogin(): array
    {
        return ['id' => '9800000001', 'mpin' => '1111', 'otp' => '987654'];
    }

    /**
     * @return array{productCode: string, secretKey: string, formUrl: string, statusUrl: string}
     */
    public static function esewaConfig(): array
    {
        return [
            'productCode' => trim((string) env('ESEWA_MERCHANT_CODE', '')) ?: self::ESEWA_TEST_PRODUCT_CODE,
            'secretKey' => trim((string) env('ESEWA_SECRET_KEY', '')) ?: self::ESEWA_TEST_SECRET,
            'formUrl' => trim((string) env('ESEWA_FORM_URL', '')) ?: self::ESEWA_FORM_URL_DEFAULT,
            'statusUrl' => trim((string) env('ESEWA_STATUS_URL', '')) ?: self::ESEWA_STATUS_URL_DEFAULT,
        ];
    }

    /**
     * @return array{secretKey: string, usingPublishedTestKey: bool, initiateUrl: string, lookupUrl: string}
     */
    public static function khaltiConfig(): array
    {
        return [
            'secretKey' => trim((string) env('KHALTI_SECRET_KEY', '')) ?: self::KHALTI_TEST_SECRET,
            'usingPublishedTestKey' => trim((string) env('KHALTI_SECRET_KEY', '')) === '',
            'initiateUrl' => trim((string) env('KHALTI_INITIATE_URL', '')) ?: self::KHALTI_INITIATE_URL_DEFAULT,
            'lookupUrl' => trim((string) env('KHALTI_LOOKUP_URL', '')) ?: self::KHALTI_LOOKUP_URL_DEFAULT,
        ];
    }

    /**
     * Where the gateway should send the browser when it is done.
     *
     * The client is the authority on its own address: on the web the app is
     * served by Expo (port 8081, or a preview host), not by this API, so the
     * request host is the wrong answer. So the app sends its origin and this
     * validates it; anything missing or unusable falls back to `appOrigin()`.
     *
     * This value only decides where a browser is sent. Money is settled by the
     * signed eSewa response and Khalti's lookup, never by the redirect, so a
     * caller that lies about its origin cannot fake a payment — it can only
     * send its own browser somewhere odd.
     */
    public static function returnOrigin(Request $request, mixed $explicit = null): string
    {
        $candidate = rtrim(trim(is_string($explicit) ? $explicit : ''), '/');

        if ($candidate !== '' && self::isUsableOrigin($candidate)) {
            return $candidate;
        }

        return self::appOrigin($request);
    }

    /** http(s), a real host, no credentials, and not the meaningless 0.0.0.0. */
    public static function isUsableOrigin(string $origin): bool
    {
        if (! filter_var($origin, FILTER_VALIDATE_URL)) {
            return false;
        }

        $parts = parse_url($origin);

        if (empty($parts['scheme']) || empty($parts['host'])) {
            return false;
        }

        if (! in_array(strtolower((string) $parts['scheme']), ['http', 'https'], true)) {
            return false;
        }

        if (isset($parts['user']) || isset($parts['pass'])) {
            return false;
        }

        return ! str_contains((string) $parts['host'], '0.0.0.0');
    }

    /**
     * The origin callbacks should point back at.
     *
     * The gateway redirects the phone's browser to a fully-qualified URL, so
     * this has to survive every way the app can be reached: a configured public
     * URL, the proxy headers, or the request itself. `0.0.0.0` hosts are
     * skipped — they are meaningless outside the machine that served them.
     */
    public static function appOrigin(Request $request): string
    {
        $envUrl = trim((string) env('APP_URL', ''));

        if ($envUrl !== '' && filter_var($envUrl, FILTER_VALIDATE_URL)) {
            $origin = parse_url($envUrl, PHP_URL_SCHEME).'://'.parse_url($envUrl, PHP_URL_HOST)
                .(parse_url($envUrl, PHP_URL_PORT) ? ':'.parse_url($envUrl, PHP_URL_PORT) : '');

            if ($origin && ! str_contains($origin, '0.0.0.0')) {
                return rtrim($origin, '/');
            }
        }

        $forwardedHost = trim(explode(',', (string) $request->headers->get('x-forwarded-host'))[0] ?? '');
        $forwardedProto = trim(explode(',', (string) $request->headers->get('x-forwarded-proto'))[0] ?? '');

        if ($forwardedProto === '' && $forwardedHost !== ''
            && ! str_starts_with($forwardedHost, 'localhost') && ! str_starts_with($forwardedHost, '127.')) {
            $forwardedProto = 'https';
        }

        $host = $forwardedHost ?: (string) $request->headers->get('host', '');

        if ($host !== '' && ! str_starts_with($host, '0.0.0.0')) {
            $proto = $forwardedProto
                ?: (str_contains($host, 'localhost') || str_starts_with($host, '127.') ? 'http' : 'https');

            return $proto.'://'.$host;
        }

        $origin = trim((string) $request->headers->get('origin', ''));

        if ($origin !== '' && ! str_contains($origin, '0.0.0.0') && filter_var($origin, FILTER_VALIDATE_URL)) {
            return rtrim($origin, '/');
        }

        $referer = trim((string) $request->headers->get('referer', ''));

        if ($referer !== '' && filter_var($referer, FILTER_VALIDATE_URL)) {
            $parsed = parse_url($referer);

            if (! empty($parsed['scheme']) && ! empty($parsed['host'])) {
                $built = $parsed['scheme'].'://'.$parsed['host'].(isset($parsed['port']) ? ':'.$parsed['port'] : '');

                if (! str_contains($built, '0.0.0.0')) {
                    return $built;
                }
            }
        }

        $host = $request->getHost();

        return str_starts_with($host, '0.0.0.0') ? 'http://localhost:8000' : $request->getScheme().'://'.$host;
    }

    public static function makeEsewaUuid(int $bookingId): string
    {
        return sprintf('FN-%d-%s-%s', $bookingId, base_convert((string) (int) (microtime(true) * 1000), 10, 36), Str::lower(Str::random(8)));
    }

    public static function signEsewaMessage(string $message, string $secretKey): string
    {
        return base64_encode(hash_hmac('sha256', $message, $secretKey, true));
    }

    /**
     * @return array<string, string>
     */
    public static function buildEsewaFields(array $opts): array
    {
        $total = (string) $opts['amount'];
        $signedFieldNames = 'total_amount,transaction_uuid,product_code';
        $message = "total_amount={$total},transaction_uuid={$opts['transactionUuid']},product_code={$opts['productCode']}";

        return [
            'amount' => $total,
            'tax_amount' => '0',
            'total_amount' => $total,
            'transaction_uuid' => $opts['transactionUuid'],
            'product_code' => $opts['productCode'],
            'product_service_charge' => '0',
            'product_delivery_charge' => '0',
            'success_url' => $opts['successUrl'],
            'failure_url' => $opts['failureUrl'],
            'signed_field_names' => $signedFieldNames,
            'signature' => self::signEsewaMessage($message, $opts['secretKey']),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function decodeEsewaData(string $dataB64): ?array
    {
        $json = base64_decode($dataB64, true);

        if ($json === false) {
            return null;
        }

        $decoded = json_decode($json, true);

        return is_array($decoded) ? $decoded : null;
    }

    public static function verifyEsewaSignature(array $payload, string $secretKey): bool
    {
        $fields = array_values(array_filter(array_map(
            'trim',
            explode(',', (string) ($payload['signed_field_names'] ?? 'total_amount,transaction_uuid,product_code'))
        ), fn ($s) => $s !== ''));

        $message = implode(',', array_map(
            fn ($f) => $f.'='.(string) ($payload[$f] ?? ''),
            $fields
        ));

        return hash_equals(self::signEsewaMessage($message, $secretKey), (string) ($payload['signature'] ?? ''));
    }

    public static function parseBookingIdFromEsewaUuid(string $uuid): ?int
    {
        if (preg_match('/^FN-(\d+)-/', $uuid, $m) !== 1) {
            return null;
        }

        $id = (int) $m[1];

        return $id > 0 ? $id : null;
    }

    public static function makeKhaltiOrderId(int $bookingId): string
    {
        return sprintf('FN-%d-%s-%s', $bookingId, base_convert((string) (int) (microtime(true) * 1000), 10, 36), Str::lower(Str::random(6)));
    }

    public static function parseBookingIdFromKhaltiOrder(string $orderId): ?int
    {
        if (preg_match('/^FN-(\d+)-/', $orderId, $m) !== 1) {
            return null;
        }

        $id = (int) $m[1];

        return $id > 0 ? $id : null;
    }

    /*
     |--------------------------------------------------------------------------
     | League entry references
     |--------------------------------------------------------------------------
     |
     | A league entry is paid by a squad in a league, not by a booking, so its
     | gateway reference carries both ids — and a different prefix, so a league
     | callback can never be mistaken for a booking one.
     |
     */

    public static function makeLeagueEsewaUuid(int $leagueId, int $teamId): string
    {
        return sprintf('LG-%d-%d-%s-%s', $leagueId, $teamId, base_convert((string) (int) (microtime(true) * 1000), 10, 36), Str::lower(Str::random(8)));
    }

    public static function makeLeagueKhaltiOrder(int $leagueId, int $teamId): string
    {
        return sprintf('LG-%d-%d-%s-%s', $leagueId, $teamId, base_convert((string) (int) (microtime(true) * 1000), 10, 36), Str::lower(Str::random(6)));
    }

    /**
     * `LG-4-2-…` → `['leagueId' => 4, 'teamId' => 2]`, or null for anything else.
     *
     * @return array{leagueId: int, teamId: int}|null
     */
    public static function parseLeagueRef(string $ref): ?array
    {
        if (preg_match('/^LG-(\d+)-(\d+)-/', $ref, $m) !== 1) {
            return null;
        }

        $leagueId = (int) $m[1];
        $teamId = (int) $m[2];

        return $leagueId > 0 && $teamId > 0 ? ['leagueId' => $leagueId, 'teamId' => $teamId] : null;
    }

    /*
     |--------------------------------------------------------------------------
     | Gateway calls
     |--------------------------------------------------------------------------
     */

    /**
     * @return array{pidx: string, payment_url: string, raw: array<string, mixed>}
     */
    public static function khaltiInitiate(array $opts): array
    {
        $response = Http::withHeaders(['Authorization' => 'Key '.$opts['secretKey']])
            ->asJson()
            ->post($opts['initiateUrl'], [
                'return_url' => $opts['returnUrl'],
                'website_url' => $opts['websiteUrl'],
                'amount' => $opts['amountPaisa'],
                'purchase_order_id' => $opts['orderId'],
                'purchase_order_name' => $opts['orderName'],
                'customer_info' => [
                    'name' => $opts['customerName'] ?: 'Futsal Player',
                    'email' => $opts['customerEmail'] ?: 'player@futsal.np',
                    'phone' => $opts['customerPhone'] ?: '9800000000',
                ],
            ]);

        $data = $response->json() ?? [];

        if (! $response->successful()) {
            $message = $data['detail'] ?? $data['error'] ?? $data['message'] ?? null;

            throw new \RuntimeException(
                is_string($message) ? $message : 'Khalti initiate failed ('.$response->status().')'
            );
        }

        $pidx = (string) ($data['pidx'] ?? '');
        $paymentUrl = (string) ($data['payment_url'] ?? '');

        if ($pidx === '' || $paymentUrl === '') {
            throw new \RuntimeException('Khalti did not return payment_url');
        }

        return ['pidx' => $pidx, 'payment_url' => $paymentUrl, 'raw' => $data];
    }

    /**
     * @return array<string, mixed>
     */
    public static function khaltiLookup(array $opts): array
    {
        $response = Http::withHeaders(['Authorization' => 'Key '.$opts['secretKey']])
            ->connectTimeout(3)->timeout(10)
            ->asJson()
            ->post($opts['lookupUrl'], ['pidx' => $opts['pidx']]);

        $data = $response->json() ?? [];

        if (! $response->successful()) {
            $message = $data['detail'] ?? $data['error'] ?? null;

            throw new \RuntimeException(
                is_string($message) ? $message : 'Khalti lookup failed ('.$response->status().')'
            );
        }

        return $data;
    }

    /**
     * @return array<string, mixed>
     */
    public static function esewaStatusCheck(array $opts): array
    {
        $response = Http::connectTimeout(3)->timeout(10)->get($opts['statusUrl'], [
            'product_code' => $opts['productCode'],
            'transaction_uuid' => $opts['transactionUuid'],
            'total_amount' => (string) $opts['totalAmount'],
        ]);

        if (! $response->successful()) {
            throw new \RuntimeException('eSewa status check failed ('.$response->status().')');
        }

        return $response->json() ?? [];
    }
}
