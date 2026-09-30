<?php

namespace App\Support;

use Illuminate\Support\Facades\Schema;
use Symfony\Component\Console\Output\OutputInterface;

/**
 * Additive storage added by this release, applied before the dev server starts.
 *
 * The user's whole workflow is `git pull`, `php artisan serve`, `npx expo start`,
 * so a table this code needs cannot wait for a manual `php artisan migrate`.
 * Only these named, purely additive migrations run here — never arbitrary
 * pending application migrations, and never on a normal HTTP request.
 */
class StartupSchema
{
    /**
     * table => migration file, in dependency order.
     *
     * @var array<string, string>
     */
    public const TABLES = [
        'booking_guest_payments' => '2026_09_30_000029_create_booking_guest_payments_table.php',
        'court_opening_hours' => '2026_09_30_000030_add_court_opening_hours.php',
    ];

    public function ensure(OutputInterface $output): void
    {
        foreach (self::TABLES as $table => $file) {
            if ($this->present($table)) {
                continue;
            }

            $output->writeln('<info>Preparing new storage: '.$table.'...</info>');
            app('migrator')->setOutput($output)->run([database_path('migrations/'.$file)], ['step' => true]);

            if (! $this->present($table)) {
                throw new \RuntimeException("Startup migration for {$table} did not take effect. Server was not started.");
            }
        }
    }

    /** courts gained columns rather than a table, so it needs its own check. */
    private function present(string $table): bool
    {
        return $table === 'court_opening_hours'
            ? Schema::hasTable('courts') && Schema::hasColumn('courts', 'opens_at') && Schema::hasColumn('courts', 'closes_at')
            : Schema::hasTable($table);
    }
}
