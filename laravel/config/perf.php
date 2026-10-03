<?php

/*
|--------------------------------------------------------------------------
| Request timing
|--------------------------------------------------------------------------
|
| `/api/health` reports how fast this server is actually answering, and
| `storage/framework/perf.jsonl` keeps the raw samples. It exists because
| "the app is slow" is not something you can fix by reading code — the answer
| is always one of three things, and they need different fixes: an endpoint
| that runs sixty queries, a server answering one request at a time, or a
| client asking for too much at once.
|
| Tracking is on in development (APP_DEBUG) and off in production, where a
| profiler belongs in the host's tooling rather than in the request path. Set
| PERF_TRACK to force it either way.
|
*/

return [

    'enabled' => env('PERF_TRACK') === null
        ? (bool) env('APP_DEBUG', false)
        : filter_var(env('PERF_TRACK'), FILTER_VALIDATE_BOOL),

    /** Anything at or above this is written to the log whatever the sampling. */
    'slow_ms' => (float) env('PERF_SLOW_MS', 250),

    /** ...and one in this many of the fast ones, so the summary has a baseline. */
    'sample' => max(1, (int) env('PERF_SAMPLE', 10)),

    'path' => storage_path('framework/perf.jsonl'),

    /** The window is capped: old samples are dropped rather than the disk filling. */
    'max_bytes' => 512 * 1024,

    /** How many of the most recent samples the health summary reads. */
    'read_samples' => 300,

    /** How many slow rows the health summary lists. */
    'slowest' => 6,

];
