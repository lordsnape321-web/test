<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class HealthController extends ApiController
{
    /**
     * GET /api/health — is the API up, and can it reach the database?
     *
     * The app calls this on its connection banner, so it answers 500 with
     * `{ ok: false }` rather than throwing: a dead database is an answer, not
     * an error to unwind.
     */
    public function __invoke(): JsonResponse
    {
        try {
            DB::select('select 1');

            return $this->ok(['ok' => true]);
        } catch (\Throwable) {
            return $this->ok(['ok' => false], 500);
        }
    }
}
