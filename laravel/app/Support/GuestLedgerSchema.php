<?php

namespace App\Support;

use Illuminate\Support\Facades\Schema;
use Symfony\Component\Console\Output\OutputInterface;

class GuestLedgerSchema
{
    /** Only this additive migration, not arbitrary pending application migrations. */
    public function ensure(OutputInterface $output): void
    {
        if (Schema::hasTable('booking_guest_payments')) {
            return;
        }
        $output->writeln('<info>Creating guest payment ledger storage...</info>');
        app('migrator')->setOutput($output)->run([
            database_path('migrations/2026_09_30_000029_create_booking_guest_payments_table.php'),
        ], ['step' => true]);
        if (! Schema::hasTable('booking_guest_payments')) {
            throw new \RuntimeException('Guest ledger migration failed. Server was not started.');
        }
    }
}
