<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\BookingPayment;
use App\Models\Court;
use App\Models\User;
use App\Models\Venue;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BookingPaymentFlowTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $player;
    private Court $court;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::create(['name' => 'Owner', 'email' => 'owner@test.example', 'role' => 'owner']);
        $this->player = User::create(['name' => 'Player', 'email' => 'player@test.example']);
        $venue = Venue::create(['name' => 'Test Venue', 'address' => 'Kathmandu', 'owner_id' => $this->owner->id]);
        $this->court = Court::create(['name' => 'Test Court', 'venue_id' => $venue->id, 'price_per_hour' => 1700]);
    }

    private function book(): int
    {
        return $this->postJson('/api/bookings', [
            'courtId' => $this->court->id, 'userId' => $this->player->id,
            'date' => now()->addDays(2)->toDateString(), 'startTime' => '18:00', 'durationHours' => 1,
        ])->assertCreated()->assertJsonPath('booking.totalPrice', 1700)->json('booking.id');
    }

    private function verifyPayment(int $id, string $gateway, string $session)
    {
        return $this->postJson("/api/payments/{$gateway}/verify", [
            'bookingId' => $id, 'userId' => $this->player->id, 'mockApprove' => true,
            'uuid' => $session, 'pidx' => 'mock-'.$session,
        ]);
    }

    private function assertMoney(int $id, int $received, int $balance): void
    {
        $this->getJson("/api/bookings/{$id}/ledger")->assertOk()
            ->assertJsonPath('totals.paid', $received)->assertJsonPath('totals.balance', $balance);
        foreach (['', '?userId='.$this->player->id] as $viewer) {
            $rows = $this->getJson('/api/bookings'.$viewer)->assertOk()->json('bookings');
            $booking = collect($rows)->firstWhere('id', $id);
            self::assertNotNull($booking);
            self::assertSame($received, $booking['paymentSummary']['received']);
            self::assertSame($balance, $booking['paymentSummary']['receivable']);
        }
    }

    public function test_unpaid_request_accept_reject_and_payment_method_updates_do_not_crash(): void
    {
        $id = $this->book();
        $this->assertMoney($id, 0, 1700);
        $this->patchJson("/api/bookings/{$id}", [
            'actor' => 'player', 'actorId' => $this->player->id, 'paymentMethod' => 'Khalti',
        ])->assertOk();
        $this->patchJson("/api/bookings/{$id}", [
            'actor' => 'owner', 'actorId' => $this->owner->id, 'status' => 'confirmed',
        ])->assertOk();
        $this->patchJson("/api/bookings/{$id}", [
            'actor' => 'owner', 'actorId' => $this->owner->id, 'status' => 'rejected',
        ])->assertOk();
        $this->assertMoney($id, 0, 1700);
    }

    public function test_esewa_advance_retry_balance_and_cash_corrections(): void
    {
        $this->advanceFlow('esewa');
    }

    public function test_khalti_advance_retry_balance_and_cash_corrections(): void
    {
        $this->advanceFlow('khalti');
    }

    private function advanceFlow(string $gateway): void
    {
        $id = $this->book();
        $this->patchJson("/api/bookings/{$id}", [
            'actor' => 'owner', 'actorId' => $this->owner->id,
            'advancePayment' => 'custom', 'advancePaymentAmount' => 500,
        ])->assertOk()->assertJsonPath('advancePaymentStatus', 'pending');
        $this->assertMoney($id, 0, 1700);
        // Opening/cancelling checkout is not a payment.
        $this->postJson('/api/payments/khalti/verify', ['bookingId' => $id, 'pidx' => 'mock-cancelled'])
            ->assertStatus(400);
        $this->assertMoney($id, 0, 1700);

        $this->verifyPayment($id, $gateway, 'advance-1')->assertOk()
            ->assertJsonPath('booking.advancePaymentStatus', 'paid')
            ->assertJsonPath('booking.paidAmount', 500)
            ->assertJsonPath('booking.paymentStatus', 'pending');
        $this->verifyPayment($id, $gateway, 'advance-1')->assertOk()->assertJsonPath('duplicate', true);
        $this->assertMoney($id, 500, 1200);
        self::assertSame(1, BookingPayment::where('booking_id', $id)->count());

        $this->verifyPayment($id, $gateway, 'balance-2')->assertOk()
            ->assertJsonPath('booking.paymentStatus', 'paid')->assertJsonPath('booking.paidAmount', 1700);
        $this->verifyPayment($id, $gateway, 'balance-2')->assertOk()->assertJsonPath('duplicate', true);
        $this->assertMoney($id, 1700, 0);
        self::assertSame(2, BookingPayment::where('booking_id', $id)->count());

        $extra = $this->postJson("/api/bookings/{$id}/ledger", [
            'actorId' => $this->owner->id, 'action' => 'addExtra', 'label' => 'Water', 'amount' => 200,
        ])->assertOk()->assertJsonPath('ledger.totals.balance', 200)->json('ledger.extras.0.id');
        $payment = $this->postJson("/api/bookings/{$id}/ledger", [
            'actorId' => $this->owner->id, 'action' => 'addPayment', 'amount' => 200, 'method' => 'Cash at Venue',
        ])->assertOk()->assertJsonPath('ledger.paymentStatus', 'paid')->json('ledger.payments.2.id');
        $this->assertMoney($id, 1900, 0);
        $this->postJson("/api/bookings/{$id}/ledger", [
            'actorId' => $this->owner->id, 'action' => 'voidPayment', 'paymentId' => $payment,
        ])->assertOk();
        $this->assertMoney($id, 1700, 200);
        $this->postJson("/api/bookings/{$id}/ledger", [
            'actorId' => $this->owner->id, 'action' => 'voidExtra', 'extraId' => $extra,
        ])->assertOk();
        $this->assertMoney($id, 1700, 0);
    }

    public function test_old_khalti_receipt_is_not_reinserted_under_a_new_reference(): void
    {
        $id = $this->book();
        BookingPayment::create([
            'booking_id' => $id, 'amount' => 500, 'method' => 'Khalti',
            'source' => 'gateway', 'reference' => 'MOCK-mock-pidx', 'recorded_by' => $this->player->id,
        ]);
        \App\Support\BookingLedger::syncCachedState(Booking::findOrFail($id));
        $this->postJson('/api/payments/khalti/verify', [
            'bookingId' => $id, 'pidx' => 'mock-pidx', 'mockApprove' => true,
        ])->assertOk()->assertJsonPath('duplicate', true);
        $this->assertMoney($id, 500, 1200);
        self::assertSame(500, Booking::findOrFail($id)->paid_amount);
        self::assertSame(1, BookingPayment::where('booking_id', $id)->count());
    }

    public function test_new_checkout_on_a_fully_paid_booking_does_not_add_money(): void
    {
        $id = $this->book();
        $this->verifyPayment($id, 'esewa', 'full-1')->assertOk();
        $this->verifyPayment($id, 'esewa', 'full-2')->assertOk()->assertJsonPath('alreadyPaid', true);
        $this->assertMoney($id, 1700, 0);
        self::assertSame(1, BookingPayment::where('booking_id', $id)->count());
    }

    public function test_gateway_failure_rolls_back_cached_status_and_ledger(): void
    {
        $id = $this->book();
        BookingPayment::creating(function () { throw new \RuntimeException('Simulated ledger failure'); });
        try {
            $this->verifyPayment($id, 'esewa', 'failed-write')->assertStatus(500);
        } finally {
            BookingPayment::flushEventListeners();
        }
        self::assertSame(0, Booking::findOrFail($id)->paid_amount);
        $this->assertMoney($id, 0, 1700);
    }

    public function test_repair_is_dry_run_by_default_and_preserves_payment_rows(): void
    {
        $id = $this->book();
        BookingPayment::create(['booking_id' => $id, 'amount' => 500, 'method' => 'eSewa', 'recorded_by' => $this->player->id]);
        Booking::findOrFail($id)->forceFill(['paid_amount' => 1700, 'payment_status' => 'paid'])->save();
        $updatedAt = Booking::findOrFail($id)->getRawOriginal('updated_at');
        $this->travel(5)->seconds();
        $this->artisan('bookings:reconcile-payments', ['--booking' => $id])->assertSuccessful();
        self::assertSame(1700, Booking::findOrFail($id)->paid_amount);
        $this->artisan('bookings:reconcile-payments', ['--booking' => $id, '--apply' => true])->assertSuccessful();
        self::assertSame(500, Booking::findOrFail($id)->paid_amount);
        self::assertSame('pending', Booking::findOrFail($id)->payment_status);
        self::assertSame($updatedAt, Booking::findOrFail($id)->getRawOriginal('updated_at'));
        $this->artisan('bookings:reconcile-payments', ['--booking' => $id, '--apply' => true])
            ->expectsOutput('0 booking(s) corrected.')->assertSuccessful();
        $this->travelBack();
        self::assertSame(1, BookingPayment::where('booking_id', $id)->count());
        $this->assertMoney($id, 500, 1200);
        $this->patchJson("/api/bookings/{$id}", [
            'actor' => 'owner', 'actorId' => $this->owner->id,
            'advancePayment' => 'custom', 'advancePaymentAmount' => 700,
        ])->assertOk();
    }
}
