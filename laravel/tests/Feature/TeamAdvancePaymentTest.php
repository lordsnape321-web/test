<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\BookingPayment;
use App\Models\BookingPaymentRequest;
use App\Models\BookingTeamPayment;
use App\Models\Court;
use App\Models\Team;
use App\Models\TeamMember;
use App\Models\User;
use App\Models\Venue;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TeamAdvancePaymentTest extends TestCase
{
    use RefreshDatabase;

    private User $booker;
    private User $mate;
    private User $other;
    private Booking $booking;

    protected function setUp(): void
    {
        parent::setUp();
        $owner = User::create(['name' => 'Owner', 'email' => 'owner@advance.test', 'role' => 'owner']);
        $this->booker = User::create(['name' => 'Booker', 'email' => 'booker@advance.test']);
        $this->mate = User::create(['name' => 'Mate', 'email' => 'mate@advance.test']);
        $this->other = User::create(['name' => 'Other', 'email' => 'other@advance.test']);
        $team = Team::create(['name' => 'Advance team', 'team_code' => 'ADVTEST', 'captain_id' => $this->booker->id]);
        foreach ([$this->booker, $this->mate, $this->other] as $player) {
            TeamMember::create(['team_id' => $team->id, 'user_id' => $player->id]);
        }
        $venue = Venue::create(['name' => 'Venue', 'address' => 'Kathmandu', 'owner_id' => $owner->id]);
        $court = Court::create(['name' => 'Court', 'venue_id' => $venue->id, 'price_per_hour' => 1800]);
        $id = $this->postJson('/api/bookings', [
            'courtId' => $court->id, 'teamId' => $team->id, 'userId' => $this->booker->id,
            'date' => now()->addDays(2)->toDateString(), 'startTime' => '18:00',
        ])->assertCreated()->json('booking.id');
        $this->booking = Booking::findOrFail($id);
        $this->patchJson("/api/bookings/{$id}", [
            'actor' => 'owner', 'actorId' => $owner->id, 'advancePayment' => 'custom', 'advancePaymentAmount' => 900,
        ])->assertOk();
    }

    private function requestFor(User $payer, int $amount = 300): int
    {
        return $this->postJson("/api/bookings/{$this->booking->id}/payment-requests", [
            'requesterId' => $this->booker->id, 'payerIds' => [$payer->id], 'amount' => $amount, 'purpose' => 'advance',
        ])->assertCreated()->json('paymentRequest.id');
    }

    public function test_teammate_contribution_then_booker_covers_remaining_esewa(): void
    {
        $this->contributionFlow('esewa', 'eSewa');
    }

    public function test_teammate_contribution_then_booker_covers_remaining_khalti(): void
    {
        $this->contributionFlow('khalti', 'Khalti');
    }

    private function contributionFlow(string $gateway, string $method): void
    {
        $id = $this->booking->id;
        $requestId = $this->requestFor($this->mate);
        $unused = $this->requestFor($this->other);
        $this->assertDatabaseHas('booking_payment_requests', ['id' => $requestId, 'status' => 'pending', 'amount_due' => 300]);
        $this->getJson("/api/bookings/{$id}/payment-requests?userId={$this->mate->id}")
            ->assertOk()->assertJsonPath('paymentRequests.0.amountDue', 300);
        $this->patchJson("/api/bookings/{$id}/payment-requests/{$requestId}", [
            'userId' => $this->mate->id, 'paymentMethod' => $method,
        ])->assertOk();
        $verify = ['bookingId' => $id, 'userId' => $this->mate->id, 'paymentRequestId' => $requestId,
            'mockApprove' => true, 'uuid' => 'mate', 'pidx' => 'mock-mate'];
        $this->postJson("/api/payments/{$gateway}/verify", $verify)->assertOk();
        $this->postJson("/api/payments/{$gateway}/verify", $verify)->assertOk()->assertJsonPath('duplicate', true);
        $this->assertDatabaseHas('booking_payment_requests', ['id' => $requestId, 'status' => 'paid', 'paid_amount' => 300]);
        $this->assertDatabaseHas('booking_team_payments', ['booking_id' => $id, 'user_id' => $this->mate->id, 'paid_amount' => 300]);
        $this->assertDatabaseHas('bookings', ['id' => $id, 'advance_payment_status' => 'pending']);
        $rows = $this->getJson('/api/bookings?userId='.$this->booker->id)->assertOk()->json('bookings');
        $fresh = collect($rows)->firstWhere('id', $id);
        self::assertSame(300, $fresh['paymentSummary']['advanceReceived']);
        self::assertSame(600, $fresh['paymentSummary']['advanceReceivable']);

        // Old screen displaying 900 cannot charge the changed amount silently.
        $self = ['bookingId' => $id, 'userId' => $this->booker->id, 'mockApprove' => true,
            'uuid' => 'self', 'pidx' => 'mock-self', 'paymentPurpose' => 'advance', 'expectedAmount' => 900];
        $this->postJson("/api/payments/{$gateway}/verify", $self)->assertStatus(409);
        $self['expectedAmount'] = 600;
        $this->postJson("/api/payments/{$gateway}/verify", $self)->assertOk();
        $this->postJson("/api/payments/{$gateway}/verify", $self)->assertOk()->assertJsonPath('duplicate', true);
        $this->assertDatabaseHas('bookings', ['id' => $id, 'advance_payment_status' => 'paid']);
        $this->assertDatabaseHas('booking_payment_requests', ['id' => $unused, 'status' => 'cancelled']);
        self::assertSame(900, (int) BookingPayment::where('booking_id', $id)->sum('amount'));
        self::assertSame(2, BookingPayment::where('booking_id', $id)->count());
        $this->postJson("/api/payments/{$gateway}/verify", [
            'bookingId' => $id, 'userId' => $this->other->id, 'paymentRequestId' => $unused,
            'mockApprove' => true, 'uuid' => 'late', 'pidx' => 'mock-late',
        ])->assertStatus(409);
        $this->getJson("/api/bookings/{$id}/ledger")->assertOk()
            ->assertJsonPath('totals.paid', 900)->assertJsonPath('totals.balance', 900);
    }

    public function test_requests_validate_authorization_amounts_and_reservations(): void
    {
        $url = "/api/bookings/{$this->booking->id}/payment-requests";
        $payload = ['requesterId' => $this->booker->id, 'payerIds' => [$this->mate->id], 'amount' => 300, 'purpose' => 'advance'];
        $this->postJson($url, array_replace($payload, ['requesterId' => $this->other->id]))->assertStatus(403);
        $this->postJson($url, array_replace($payload, ['amount' => 300.5]))->assertStatus(400);
        $this->requestFor($this->mate, 600);
        $this->postJson($url, array_replace($payload, ['payerIds' => [$this->other->id], 'amount' => 400]))->assertStatus(400);
        self::assertSame(1, BookingPaymentRequest::where('booking_id', $this->booking->id)->count());
    }

    public function test_booker_can_cover_advance_even_when_their_share_is_already_paid(): void
    {
        $id = $this->booking->id;
        BookingTeamPayment::where('booking_id', $id)->where('user_id', $this->booker->id)
            ->update(['paid_amount' => 600, 'payment_status' => 'paid']);
        $requestId = $this->requestFor($this->mate, 600);
        $payload = ['bookingId' => $id, 'userId' => $this->booker->id, 'mockApprove' => true,
            'uuid' => 'booker-all', 'paymentPurpose' => 'advance', 'expectedAmount' => 900];
        $this->postJson('/api/payments/esewa/verify', array_replace($payload, ['userId' => $this->mate->id]))
            ->assertStatus(403);
        $this->postJson('/api/payments/esewa/verify', $payload)->assertOk();
        $this->assertDatabaseHas('booking_payment_requests', ['id' => $requestId, 'status' => 'cancelled']);
        $this->assertDatabaseHas('bookings', ['id' => $id, 'advance_payment_status' => 'paid']);
        self::assertSame(900, (int) BookingPayment::where('booking_id', $id)->sum('amount'));
        // The booking player's extra contribution is not silently attributed to a teammate.
        $this->assertDatabaseHas('booking_team_payments', ['booking_id' => $id, 'user_id' => $this->mate->id, 'paid_amount' => 0]);
    }

    public function test_cancelled_request_is_persisted_and_releases_reserved_amount(): void
    {
        $id = $this->booking->id;
        $requestId = $this->requestFor($this->mate, 600);
        $url = "/api/bookings/{$id}/payment-requests/{$requestId}";
        $this->patchJson($url, ['userId' => $this->mate->id, 'action' => 'cancel'])->assertStatus(403);
        $this->patchJson($url, ['userId' => $this->booker->id, 'action' => 'cancel'])->assertOk();
        $this->assertDatabaseHas('booking_payment_requests', ['id' => $requestId, 'status' => 'cancelled']);
        $this->requestFor($this->other, 900);
        self::assertSame(2, BookingPaymentRequest::where('booking_id', $id)->count());
        self::assertSame(0, BookingPayment::where('booking_id', $id)->count());
    }

    public function test_cash_held_by_captain_does_not_cover_venue_advance(): void
    {
        BookingTeamPayment::where('booking_id', $this->booking->id)->update(['paid_amount' => 600, 'payment_status' => 'paid']);
        $this->booking->forceFill(['paid_amount' => 1800, 'payment_status' => 'paid'])->save();
        $this->requestFor($this->mate, 300);
        $this->assertDatabaseHas('bookings', ['id' => $this->booking->id, 'advance_payment_status' => 'pending']);
        self::assertSame(0, BookingPayment::where('booking_id', $this->booking->id)->count());
    }
}
