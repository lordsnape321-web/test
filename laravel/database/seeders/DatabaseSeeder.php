<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * The API seed endpoint and Artisan use the same deterministic dataset.
     * Run `php artisan migrate:fresh --seed` when replacing an older local
     * fixture; a normal second run is safe and reports existing counts.
     */
    public function run(): void
    {
        $report = app(RealWorldSeeder::class)->run();

        $this->command?->info(json_encode($report, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
}
