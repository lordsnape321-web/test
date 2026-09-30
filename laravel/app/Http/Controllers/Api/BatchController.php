<?php

namespace App\Http\Controllers\Api;

use App\Support\PerfLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Several reads in one round trip.
 *
 * The dev server (`php artisan serve`) answers **one request at a time**, so a
 * screen that needs nine things is nine requests queued end to end, each paying
 * Laravel's boot cost before anything is answered. The venue screen did exactly
 * that: venue, courts, promos, teams, leagues, vouchers, stats and bookings.
 * The app polls on top of that, and the whole thing feels slow in a way that no
 * single endpoint is responsible for.
 *
 * This route lets the client send the list and get the list back: the requests
 * are dispatched inside *this* process, which is already booted, so nine calls
 * cost one boot and one connection setup. The client does this automatically
 * (see `src/lib/api.ts` in the Expo app) — screens still call `fetchVenue()`,
 * `fetchCourts()` and so on, and the promises resolve from one HTTP request.
 *
 * Deliberately read-only. Every sub-request is a GET, so nothing here can be
 * used to smuggle a second write through a route that is not expecting one, and
 * each sub-request still runs the normal middleware stack and route model
 * binding — it is the same handling the app would have got, minus the socket.
 */
class BatchController extends ApiController
{
    /** Enough for any screen, few enough that one bad batch cannot stall everything. */
    private const MAX_REQUESTS = 12;

    /** @var list<string> */
    private const BLOCKED_PREFIXES = ['/api/batch'];

    public function __invoke(Request $request): JsonResponse
    {
        $items = $request->input('requests');

        if (! is_array($items) || $items === []) {
            return $this->fail('Send a non-empty requests[] array 📦', 400);
        }

        if (count($items) > self::MAX_REQUESTS) {
            return $this->fail('At most '.self::MAX_REQUESTS.' requests per batch 📦', 400);
        }

        // The sub-requests will replace the container's `request` binding as they
        // are handled; the outer one has to be put back afterwards.
        $outer = app('request');
        $responses = [];

        // Counted so each batched read can report its own query cost in the
        // perf log — otherwise nine reads in one request is one opaque number.
        $queries = 0;
        $dbMs = 0.0;

        DB::listen(function ($query) use (&$queries, &$dbMs): void {
            $queries++;
            $dbMs += (float) $query->time;
        });

        foreach ($items as $item) {
            $path = is_array($item) ? trim((string) ($item['path'] ?? '')) : '';

            if (! self::isAllowed($path)) {
                $responses[] = [
                    'status' => 400,
                    'body' => ['error' => 'Only GET /api paths can be batched 📦'],
                ];

                continue;
            }

            $before = $queries;
            $beforeMs = $dbMs;
            $started = microtime(true);

            [$status, $body, $label] = $this->dispatch($request, $path);

            PerfLog::record([
                'route' => 'batch → '.$label,
                'status' => $status,
                'ms' => (microtime(true) - $started) * 1000,
                'queries' => $queries - $before,
                'db_ms' => $dbMs - $beforeMs,
            ]);

            $responses[] = ['status' => $status, 'body' => $body];
        }

        app()->instance('request', $outer);

        return $this->ok(['responses' => $responses]);
    }

    /**
     * Handle one path as if it had arrived on its own.
     *
     * @return array{0: int, 1: mixed, 2: string} status, body, and the route it
     *                                           resolved to (for the perf log)
     */
    private function dispatch(Request $outer, string $path): array
    {
        $sub = Request::create($path, 'GET', [], [], [], [
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_X_REQUESTED_WITH' => 'XMLHttpRequest',
            'REMOTE_ADDR' => $outer->ip(),
        ]);

        try {
            $response = app()->handle($sub);
        } catch (\Throwable $e) {
            report($e);

            return [500, ['error' => $e->getMessage() ?: 'Something went wrong'], 'GET '.$path];
        } finally {
            // Every sub-request binds itself as the current request; the one the
            // response is being built for still has to be the real one.
            app()->instance('request', $outer);
        }

        $content = (string) $response->getContent();
        $decoded = json_decode($content, true);

        // Mirror what the client's own parser does with a body that is not JSON,
        // so a batched read and a solo read behave identically even when a
        // route misbehaves.
        if (! is_array($decoded)) {
            $trimmed = trim($content);
            $decoded = $trimmed === '' ? null : ['error' => $content];
        }

        $template = $sub->route()?->uri();

        return [
            $response->getStatusCode(),
            $decoded,
            'GET '.(is_string($template) && $template !== '' ? $template : $path),
        ];
    }

    /**
     * A path this route is willing to replay.
     *
     * Not a security boundary — the app's reads are all `userId`-scoped and
     * public by design — but it keeps the route honest: reads only, inside the
     * API, and no way to recurse back into itself.
     */
    private static function isAllowed(string $path): bool
    {
        if (! str_starts_with($path, '/api/')) {
            return false;
        }

        if (str_contains($path, '..') || str_contains($path, "\n") || str_contains($path, "\r")) {
            return false;
        }

        foreach (self::BLOCKED_PREFIXES as $prefix) {
            if (str_starts_with($path, $prefix)) {
                return false;
            }
        }

        return true;
    }
}
