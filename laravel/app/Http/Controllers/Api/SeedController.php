<?php

namespace App\Http\Controllers\Api;

use Database\Seeders\RealWorldSeeder;
use Illuminate\Http\JsonResponse;

/**
 * The development dataset endpoint.
 *
 * Keeping this controller thin is important: Artisan and the Expo refresh
 * button must call exactly the same deterministic seeder, not two drifting
 * copies of demo rows.
 */
class SeedController extends ApiController
{
    /** GET and POST both support the local development workflow. */
    public function index(): JsonResponse
    {
        return $this->store();
    }

    public function store(): JsonResponse
    {
        try {
            return $this->ok(app(RealWorldSeeder::class)->run());
        } catch (\Throwable $exception) {
            report($exception);

            return $this->fail('The Nepal futsal seed could not be completed: '.$exception->getMessage(), 500);
        }
    }
}
