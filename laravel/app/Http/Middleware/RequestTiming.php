<?php

namespace App\Http\Middleware;

use App\Support\PerfLog;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Times every API request and hands the sample to App\Support\PerfLog.
 *
 * The measurement covers the part the client actually waits for: it starts
 * before the route runs and stops once the response is built. Everything after
 * that (`terminate()`, where the mail pump and the reminder scan live) happens
 * after the response has been sent, so it is not in the number — which is
 * deliberate, because that is the number the person tapping the screen feels.
 *
 * The query count and the time spent in SQL come from Laravel's own
 * `DB::listen`, which is the point: "9 requests" and "1 request" are both fine
 * until you know one of them runs 400 queries.
 */
class RequestTiming
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! config('perf.enabled')) {
            return $next($request);
        }

        $started = microtime(true);
        $queries = 0;
        $dbMs = 0.0;

        DB::listen(function ($query) use (&$queries, &$dbMs): void {
            $queries++;
            $dbMs += (float) $query->time;
        });

        $response = $next($request);

        PerfLog::record([
            'route' => self::label($request),
            'status' => $response->getStatusCode(),
            'ms' => (microtime(true) - $started) * 1000,
            'queries' => $queries,
            'db_ms' => $dbMs,
        ]);

        return $response;
    }

    /**
     * "GET api/venues/{id}" — the route template, not the URL, so the same
     * screen's samples group together instead of one row per venue id.
     */
    private static function label(Request $request): string
    {
        $route = $request->route();
        $method = $request->getMethod();
        $uri = $route?->uri();

        return $method.' '.($uri ?: ltrim($request->path(), '/'));
    }
}
