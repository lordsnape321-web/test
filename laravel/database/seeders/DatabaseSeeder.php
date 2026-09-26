<?php

namespace Database\Seeders;

use App\Http\Controllers\Api\SeedController;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     *
     * The demo dataset lives with the `/api/seed` endpoint rather than here, so
     * there is exactly one copy of it and the two entry points can never drift.
     * Everything it builds is already guarded by "does this exist yet?", so
     * running either one twice is harmless.
     */
    public function run(): void
    {
        $response = app(SeedController::class)->store();

        $this->command?->info(json_encode($response->getData(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
}
