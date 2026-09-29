<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class HealthController extends ApiController
{
    /**
     * The git short-SHA of the commit this API is running. Update it with
     * every push — the app and the curl check compare against it, so a stale
     * `php artisan serve` process or an un-pulled checkout announces itself
     * instead of looking like the data is broken.
     */
    public const BUILD = '65e681f';

    /**
     * GET /api/health — is the API up, and can it reach the database?
     *
     * A database failure is deliberately returned as a structured 503 instead
     * of `{ ok: false }` with no explanation. `apiJson()` can then show the
     * actual local PDO/Laravel error, which makes a missing `pdo_mysql`
     * extension, wrong MySQL credentials, or an uncreated database immediately
     * actionable.
     */
    public function __invoke(): JsonResponse
    {
        try {
            DB::select('select 1');

            return $this->ok(['ok' => true, 'build' => self::BUILD]);
        } catch (\Throwable $e) {
            report($e);

            $message = config('app.debug')
                ? 'Database connection failed: '.$e->getMessage()
                : 'Database connection failed. Check the Laravel database configuration.';

            return $this->fail($message, 503, ['ok' => false]);
        }
    }
}
