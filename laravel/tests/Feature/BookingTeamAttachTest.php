<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\BookingPayment;
use App\Models\BookingTeamPayment;
use App\Models\Court;
use App\Models\Team;
use App\Models\TeamMember;
use App\Models\User;
use App\Models\Venue;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BookingTeamAttachTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $player;
    private User $mate;
    private User $other;
    private Team $team;
    private Team $second;
    private int $bookingId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::create(['name' => 'Owner', 'email' => 'owner@attach.test', 'role' => 'owner']);
        $this->player = User::create(['name' => 'Player', 'email' => 'player@attach.test']);
        $this->mate = User::create(['name' => 'Mate', 'email' => 'mate@attach.test']);
        $this->other = User::create(['name' => 'Other', 'email' => 'other@attach.test']);
        $this->team = Team::create(['name' => 'Squad One', 'team_code' => 'ATTACH01', 'captain_id' => $this->player->id]);
        foreach ([$this->player, $this->mate] as $person) {
            TeamMember::create(['team_id' => $this->team->id, 'user_id' => $person->id]);
        }
        $this->second = Team::create(['name' => 'Squad Two', 'team_code' => 'ATTACH02', 'captain_id' => $this->player->id]);
        TeamMember::create(['team_id' => $this->second->id, 'user_id' => $this->player->id]);
        $strangerTeam = Team::create(['name' => 'Not mine', 'team_code' => 'ATTACH03', 'captain_id' => $this->other->id]);
        TeamMember::create(['team_id' => $strangerTeam->id, 'user_id' => $this->other->id]);
        $venue = Venue::create(['name' => 'Venue', 'address' => 'Kathmandu', 'owner_id' => $this->owner->id]);
        $court = Court::create(['name' => 'Court', 'venue_id' => $venue->id, 'price_per_hour' => 1700]);
        // The mistake this feature fixes: booked "just us", no teamId.
        $this->bookingId = $this->postJson('/api/bookings', [
            'courtId' => $court->id, 'userId' => $this->player->id,
            'date' => now()->addDays(2)->toDateString(), 'startTime' => '18:00', 'durationHours' => 1,
        ])->assertCreated()->json('booking.id');
    }

    private function attach(int $teamId, ?int $actorId = null): \Illuminate\Testing\TestResponse
    {
        return $this->patchJson("/api/bookings/{$this->bookingId}", [
            'actor' => 'player', 'actorId' => $actorId ?? $this->player->id, 'teamId' => $teamId,
        ]);
    }

    public function test_a_solo_booking_can_be_split_across_the_squad_later(): void
    {
        self::assertNull(Booking::find($this->bookingId)->team_id);
        self::assertSame(0, BookingTeamPayment::count());

        $response = $this->attach($this->team->id)->assertOk();
        $booking = Booking::find($this->bookingId);
        self::assertSame($this->team->id, (int) $booking->team_id);
        self::assertSame('Squad One', $booking->team_name);
        self::assertSame($this->team->id, (int) $response->json('booking.teamId'));

        $shares = BookingTeamPayment::where('booking_id', $this->bookingId)->orderBy('user_id')->get();
        self::assertSame(2, $shares->count());
        self::assertSame(1700, (int) $shares->sum('amount_due'));
        foreach ($shares as $share) {
            self::assertSame('pending', $share->payment_status);
            self::assertSame(0, (int) $share->paid_amount);
        }
        // The split is what the ask/ledger features hang off, so it must exist now.
        $this->postJson("/api/bookings/{$this->bookingId}/payment-requests", [
            'requesterId' => $this->player->id, 'payerIds' => [$this->mate->id], 'amount' => 400, 'purpose' => 'booking',
        ])->assertCreated();
    }

    public function test_a_teammate_who_already_paid_the_venue_keeps_that_money_attributed(): void
    {
        BookingPayment::create([
            'booking_id' => $this->bookingId, 'amount' => 500, 'method' => 'eSewa',
            'source' => 'gateway', 'reference' => 'mate-early', 'recorded_by' => $this->mate->id,
        ]);

        $this->attach($this->team->id)->assertOk();
        $share = BookingTeamPayment::where('booking_id', $this->bookingId)->where('user_id', $this->mate->id)->firstOrFail();
        self::assertSame(500, (int) $share->paid_amount);
        self::assertSame('partial', $share->payment_status);
        $this->getJson("/api/bookings/{$this->bookingId}/ledger")->assertOk()->assertJsonPath('totals.paid', 500);
    }

    public function test_only_the_booker_may_attach_and_only_their_own_team(): void
    {
        $this->attach($this->team->id, $this->other->id)->assertStatus(403);
        $stranger = Team::where('team_code', 'ATTACH03')->firstOrFail();
        $this->attach($stranger->id)->assertStatus(400);
        $this->patchJson("/api/bookings/{$this->bookingId}", [
            'actor' => 'owner', 'actorId' => $this->owner->id, 'teamId' => $this->team->id,
        ])->assertStatus(403);
        self::assertSame(0, BookingTeamPayment::count());
    }

    public function test_attaching_is_idempotent_but_swapping_after_collections_is_refused(): void
    {
        $this->attach($this->team->id)->assertOk();
        $this->attach($this->team->id)->assertOk();
        self::assertSame(2, BookingTeamPayment::where('booking_id', $this->bookingId)->count());

        // Recording money on a share freezes the roster: re-splitting would
        // silently rewrite who owes what.
        BookingTeamPayment::where('booking_id', $this->bookingId)->where('user_id', $this->mate->id)
            ->update(['paid_amount' => 100, 'payment_status' => 'partial']);
        $this->attach($this->second->id)->assertStatus(409);
        self::assertSame('Squad One', Booking::find($this->bookingId)->team_name);
    }

    public function test_a_closed_booking_cannot_gain_a_team(): void
    {
        Booking::where('id', $this->bookingId)->update(['status' => 'cancelled']);
        $this->attach($this->team->id)->assertStatus(409);
        self::assertNull(Booking::find($this->bookingId)->team_id);
    }
}
