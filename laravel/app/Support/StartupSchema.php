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
     * storage => [migration file, the table it alters].
     *
     * A null parent means the migration creates its own table. When the parent
     * does not exist yet the database has never been migrated at all, and the
     * whole schema is `php artisan migrate`'s job — see present().
     *
     * @var array<string, array{0: string, 1: ?string}>
     */
    public const TABLES = [
        'booking_guest_payments' => ['2026_09_30_000029_create_booking_guest_payments_table.php', null],
        'court_opening_hours' => ['2026_09_30_000030_add_court_opening_hours.php', 'courts'],
        'court_day_hours' => ['2026_09_30_000031_create_court_day_hours_table.php', 'courts'],
        'venue_location_url' => ['2026_09_30_000032_add_location_url_to_venues.php', 'venues'],
    ];

    public function ensure(OutputInterface $output): void
    {
        foreach (self::TABLES as $storage => [$file, $parent]) {
            if ($this->present($storage, $parent)) {
                continue;
            }

            $output->writeln('<info>Preparing new storage: '.$storage.'...</info>');
            app('migrator')->setOutput($output)->run([database_path('migrations/'.$file)], ['step' => true]);

            if (! $this->present($storage, $parent)) {
                throw new \RuntimeException("Startup migration for {$storage} did not take effect. Server was not started.");
            }
        }
    }

    /**
     * Has this piece of storage already been applied?
     *
     * Most entries create their own table and are recognised by it. The others
     * add columns to an existing table, so they check for those columns — and
     * fall back to "already present" when even the parent table is missing,
     * which means the schema has not been built yet and `php artisan migrate`
     * will create all of it in order.
     */
    private function present(string $storage, ?string $parent): bool
    {
        if ($parent !== null && ! Schema::hasTable($parent)) {
            return true;
        }

        return match ($storage) {
            'court_opening_hours' => Schema::hasColumn('courts', 'opens_at') && Schema::hasColumn('courts', 'closes_at'),
            'venue_location_url' => Schema::hasColumn('venues', 'location_url'),
            default => Schema::hasTable($storage),
        };
    }
}
