<?php

namespace App\Console\Commands;

use App\Models\Booking;
use App\Support\BookingLedger;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ReconcileBookingPayments extends Command
{
    protected $signature = 'bookings:reconcile-payments {--booking= : Limit to a booking ID} {--apply : Save corrections; otherwise only preview}';

    protected $description = 'Rebuild cached payment statuses from existing ledger/share rows (dry-run by default)';

    public function handle(): int
    {
        $id = $this->option('booking');
        if ($id !== null && (! ctype_digit((string) $id) || (int) $id <= 0)) {
            $this->error('--booking must be a positive booking ID.');
            return self::FAILURE;
        }

        $changed = 0;
        Booking::query()->when($id, fn ($q) => $q->where('id', $id))
            ->select('id')->chunkById(100, function ($rows) use (&$changed) {
                foreach ($rows as $row) {
                    DB::transaction(function () use ($row, &$changed) {
                        $booking = Booking::lockForUpdate()->find($row->id);
                        if (! $booking) {
                            return;
                        }
                        $before = $booking->only(['paid_amount', 'payment_status', 'deposit_status', 'advance_payment_status']);
                        $booking->forceFill(BookingLedger::cachedState($booking));
                        if (! $booking->isDirty()) {
                            return;
                        }
                        $this->line('#'.$booking->id.' '.json_encode($before).' -> '.json_encode($booking->getDirty()));
                        if ($this->option('apply')) {
                            // Repairing a derived cache is not a new booking
                            // activity. Keep the original updated_at intact.
                            $booking->timestamps = false;
                            $changes = $booking->getDirty();
                            $booking->save();
                            Log::info('Booking payment cache reconciled', [
                                'booking_id' => $booking->id,
                                'before' => $before,
                                'changes' => $changes,
                            ]);
                        }
                        $changed++;
                    });
                }
            });

        $this->info($changed.' booking(s) '.($this->option('apply') ? 'corrected.' : 'need correction. Dry run only; use --apply after reviewing.'));
        return self::SUCCESS;
    }
}
