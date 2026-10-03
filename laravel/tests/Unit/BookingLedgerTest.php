<?php

namespace Tests\Unit;

use App\Models\BookingExtra;
use App\Models\BookingPayment;
use App\Support\BookingLedger;
use Tests\TestCase;

class BookingLedgerTest extends TestCase
{
    public function test_eloquent_models_count_amounts_methods_and_voids(): void
    {
        $payment = new BookingPayment(['amount' => 700, 'method' => 'eSewa']);
        $voided = new BookingPayment(['amount' => 1000, 'method' => 'Khalti', 'voided_at' => '2026-09-01 10:00:00']);
        $extra = new BookingExtra(['amount' => 200]);
        $voidedExtra = new BookingExtra(['amount' => 900, 'voided_at' => '2026-09-01 10:00:00']);

        $totals = BookingLedger::ledgerTotals(1700, [$extra, $voidedExtra], [$payment, $voided]);
        self::assertSame(200, $totals['extrasTotal']);
        self::assertSame(700, $totals['paid']);
        self::assertSame(1200, $totals['balance']);
        self::assertSame(['eSewa' => 700], $totals['byMethod']);
        self::assertFalse(BookingLedger::isLive($voided));
    }

    public function test_legacy_arrays_and_query_builder_rows_still_work(): void
    {
        $totals = BookingLedger::ledgerTotals(1000, [], [
            ['amount' => 600, 'method' => 'eSewa', 'voidedAt' => null],
            (object) ['amount' => 500, 'method' => 'Cash at Venue', 'voided_at' => null],
            ['amount' => 900, 'method' => 'Khalti', 'voidedAt' => '2026-09-01'],
            (object) ['amount' => 800, 'method' => 'Khalti', 'voided_at' => '2026-09-01'],
        ]);
        self::assertSame(1100, $totals['paid']);
        self::assertSame(0, $totals['balance']);
        self::assertSame(100, $totals['surplus']);
        self::assertSame(['eSewa' => 600, 'Cash at Venue' => 500], $totals['byMethod']);
    }
}
