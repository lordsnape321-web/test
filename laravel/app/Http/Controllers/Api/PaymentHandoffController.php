<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;

/**
 * A one-page hand-off to eSewa for browsers that cannot POST a form themselves.
 *
 * eSewa's checkout is a form POST — the merchant page builds hidden inputs and
 * submits them to `rc-epay.esewa.com.np`. A browser can do that; a native app
 * cannot, because `Linking.openURL()` only issues GETs. So the app opens this
 * page in the system browser, this page rebuilds the same signed form, and the
 * browser posts it to eSewa a moment later.
 *
 * The page does not re-implement any of the payment rules. It replays the same
 * `POST /api/payments/esewa/initiate` the web client calls directly — same
 * target checks, same amount maths, same persisted transaction uuid — and then
 * renders whatever that endpoint signed. If it refuses (a played game, a paid
 * share, a cancelled booking), the message is shown as-is instead of a raw JSON
 * body in the browser.
 */
class PaymentHandoffController extends ApiController
{
    /** GET /api/payments/esewa/handoff?bookingId=…&teamPaymentId=…&returnOrigin=… */
    public function esewa(Request $request)
    {
        $payload = [
            'bookingId' => $request->query('bookingId'),
            'teamPaymentId' => $request->query('teamPaymentId'),
            'paymentRequestId' => $request->query('paymentRequestId'),
            'userId' => $request->query('userId'),
            // Carried through untouched so the signed success/failure URLs point
            // back at the app that opened this page, not at this API.
            'returnOrigin' => $request->query('returnOrigin'),
            'successUrl' => $request->query('successUrl'),
            'failureUrl' => $request->query('failureUrl'),
        ];

        ['status' => $status, 'data' => $data] = $this->initiate($payload, $request);

        $fields = is_array($data['fields'] ?? null) ? $data['fields'] : null;
        $formUrl = is_string($data['url'] ?? null) ? $data['url'] : '';

        if ($status !== 200 || $fields === null || $formUrl === '') {
            return $this->html($this->errorPage(
                is_string($data['error'] ?? null)
                    ? $data['error']
                    : 'The gateway could not start this payment.'
            ), $status === 200 ? 502 : $status);
        }

        return $this->html($this->formPage($formUrl, $fields, $data));
    }

    /**
     * The same hand-off for a league entry fee.
     *
     * A league payment starts at `POST /api/tournaments/{id}/payments` with
     * `action=initiate` rather than the booking endpoint, so the replay points
     * there — but everything else (the signed form, the query-free return URLs,
     * the error page) is identical, and deliberately so: one page, one contract.
     */
    public function leagueEsewa(Request $request)
    {
        $leagueId = (int) $request->query('leagueId', 0);

        if ($leagueId <= 0) {
            return $this->html($this->errorPage('That league payment could not start.'), 400);
        }

        $payload = [
            'action' => 'initiate',
            'teamId' => $request->query('teamId'),
            'userId' => $request->query('userId'),
            'amount' => $request->query('amount'),
            'method' => 'eSewa',
            'returnOrigin' => $request->query('returnOrigin'),
            'successUrl' => $request->query('successUrl'),
            'failureUrl' => $request->query('failureUrl'),
        ];

        ['status' => $status, 'data' => $data] = $this->initiate($payload, $request, "/api/tournaments/{$leagueId}/payments");

        $fields = is_array($data['fields'] ?? null) ? $data['fields'] : null;
        $formUrl = is_string($data['url'] ?? null) ? $data['url'] : '';

        if ($status !== 200 || $fields === null || $formUrl === '') {
            return $this->html($this->errorPage(
                is_string($data['error'] ?? null)
                    ? $data['error']
                    : 'The gateway could not start this payment.'
            ), $status === 200 ? 502 : $status);
        }

        return $this->html($this->formPage($formUrl, $fields, $data));
    }

    /**
     * Ask the real initiate endpoint, in-process.
     *
     * `app()->handle()` runs the request through the normal middleware stack, so
     * there is exactly one implementation of "can this booking be paid, and how
     * much". The outer request has to be rebound afterwards — every sub-request
     * binds itself as the current one (the same dance `BatchController` does).
     *
     * @return array{status: int, data: array<string, mixed>}
     */
    private function initiate(array $payload, Request $outer, string $path = '/api/payments/esewa/initiate'): array
    {
        $sub = Request::create($path, 'POST', $payload, [], [], [
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_X_REQUESTED_WITH' => 'XMLHttpRequest',
            'REMOTE_ADDR' => $outer->ip(),
        ]);

        try {
            $response = app()->handle($sub);
        } catch (\Throwable $e) {
            report($e);

            return ['status' => 500, 'data' => ['error' => $e->getMessage() ?: 'Something went wrong']];
        } finally {
            app()->instance('request', $outer);
        }

        $decoded = json_decode((string) $response->getContent(), true);

        return [
            'status' => $response->getStatusCode(),
            'data' => is_array($decoded) ? $decoded : ['error' => 'Unexpected gateway response.'],
        ];
    }

    /** @param array<string, mixed> $data */
    private function formPage(string $formUrl, array $fields, array $data): string
    {
        $inputs = '';

        foreach ($fields as $name => $value) {
            $inputs .= sprintf(
                '<input type="hidden" name="%s" value="%s">',
                e((string) $name),
                e((string) $value)
            );
        }

        $amount = isset($data['amount']) ? 'Rs '.number_format((float) $data['amount']) : 'your booking';
        $hint = e((string) ($data['testHint'] ?? ''));
        $cancel = e((string) ($data['failureUrl'] ?? ''));
        // The replica page, not the app's own route: this page is served to a
        // browser, which cannot open a route inside the app.
        $demo = e((string) ($data['demoUrl'] ?? ''));

        return $this->shell('Opening eSewa…', <<<HTML
            <h1>Taking you to eSewa</h1>
            <p class="lead">Paying <strong>{$amount}</strong> on the eSewa test server — the one eSewa publishes for testing. No real money moves.</p>
            <p class="hint">{$hint}</p>
            <form id="esewa" method="POST" action="{$formUrl}" autocomplete="off">
                {$inputs}
                <button type="submit">Continue to eSewa</button>
            </form>
            <noscript><p class="hint">JavaScript is off, so the form did not submit itself — press the button above.</p></noscript>
            <p class="hint">
                If eSewa answers &ldquo;Service is currently unavailable&rdquo;, nothing was charged —
                that is their server timing out, not a failed payment.
            </p>
            <p class="links">
                <a href="{$demo}">Pay on the demo checkout instead</a>
                <a href="{$cancel}">Cancel and go back</a>
            </p>
            <script>document.getElementById("esewa").submit();</script>
            HTML);
    }

    private function errorPage(string $message): string
    {
        $safe = e($message);

        return $this->shell('Payment could not start', <<<HTML
            <h1>That payment could not start</h1>
            <p class="lead">{$safe}</p>
            <p class="hint">Nothing was charged. Go back to the app and try again.</p>
            HTML);
    }

    private function shell(string $title, string $body): string
    {
        return <<<HTML
            <!doctype html>
            <html lang="en">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>{$title}</title>
                <style>
                    :root { color-scheme: light; }
                    * { box-sizing: border-box; }
                    body {
                        margin: 0; min-height: 100vh; display: grid; place-items: center;
                        padding: 24px; background: #F5F5F4; color: #1C1917;
                        font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    }
                    main {
                        width: 100%; max-width: 460px; background: #FFFFFF; border: 1px solid #E7E5E4;
                        border-radius: 24px; padding: 32px 28px; box-shadow: 0 12px 32px rgba(0,0,0,.06);
                    }
                    h1 { margin: 0 0 12px; font-size: 24px; }
                    .lead { margin: 0 0 16px; color: #44403C; }
                    .hint { margin: 0 0 16px; font-size: 13px; color: #78716C; }
                    form { margin: 0; }
                    button {
                        width: 100%; min-height: 52px; border: 0; border-radius: 16px; cursor: pointer;
                        background: #087443; color: #FFFFFF; font-size: 17px; font-weight: 700;
                    }
                    button:active { transform: translateY(1px); }
                    .links { display: flex; flex-direction: column; gap: 8px; margin: 20px 0 0; font-size: 14px; }
                    .links a { color: #78716C; }
                    .links a:first-child { color: #087443; font-weight: 600; }
                </style>
            </head>
            <body>
                <main>{$body}</main>
            </body>
            </html>
            HTML;
    }

    private function html(string $body, int $status = 200)
    {
        return response($body, $status)->header('Content-Type', 'text/html; charset=utf-8');
    }
}
