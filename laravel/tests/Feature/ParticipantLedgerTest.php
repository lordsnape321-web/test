<?php

namespace Tests\Feature;

use App\Models\Booking;
use App\Models\BookingGuestPayment;
use App\Models\BookingPayment;
use App\Models\BookingPaymentRequest;
use App\Models\BookingTeamPayment;
use App\Models\Court;
use App\Models\MatchJoin;
use App\Models\OpenMatch;
use App\Models\Team;
use App\Models\TeamLedgerEntry;
use App\Models\TeamMember;
use App\Models\User;
use App\Models\Venue;
use App\Support\StartupSchema;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Symfony\Component\Console\Output\BufferedOutput;
use Tests\TestCase;

class ParticipantLedgerTest extends TestCase
{
    use RefreshDatabase;

    private Booking $booking;
    private User $host;
    private User $mate;
    private User $outsider;

    protected function setUp(): void
    {
        parent::setUp();
        $this->host = User::create(['name' => 'Host', 'email' => 'host@ledger.test']);
        $this->mate = User::create(['name' => 'Mate', 'email' => 'mate@ledger.test']);
        $this->outsider = User::create(['name' => 'Open player', 'email' => 'open@ledger.test']);
        $venue = Venue::create(['name' => 'Venue', 'address' => 'Kathmandu', 'owner_id' => $this->host->id]);
        $court = Court::create(['venue_id' => $venue->id, 'name' => 'Court']);
        $team = Team::create(['name' => 'Team', 'team_code' => 'LEDGERTEST', 'captain_id' => $this->host->id]);
        foreach ([$this->host, $this->mate] as $person) {
            TeamMember::create(['team_id' => $team->id, 'user_id' => $person->id]);
        }
        $this->booking = Booking::create([
            'court_id' => $court->id, 'user_id' => $this->host->id, 'team_id' => $team->id,
            'date' => now()->addDays(2)->toDateString(), 'start_time' => '18:00', 'end_time' => '19:00', 'total_price' => 1800,
        ]);
    }

    private function url(): string
    {
        return '/api/bookings/'.$this->booking->id.'/team-ledger';
    }

    private function share(int $paid = 0): BookingTeamPayment
    {
        return BookingTeamPayment::create([
            'booking_id' => $this->booking->id, 'team_id' => $this->booking->team_id,
            'user_id' => $this->mate->id, 'amount_due' => 600, 'paid_amount' => $paid,
            'payment_method' => 'eSewa', 'payment_status' => $paid === 600 ? 'paid' : 'pending',
        ]);
    }

    private function member(array $payload, int $userId): array
    {
        return collect($payload['members'])->firstWhere('userId', $userId);
    }

    private function organizerPaysEverything(int $amount = 1800): void
    {
        BookingPayment::create([
            'booking_id' => $this->booking->id, 'amount' => $amount, 'method' => 'eSewa',
            'source' => 'gateway', 'reference' => 'organizer-solo', 'recorded_by' => $this->host->id,
        ]);
    }

    public function test_organizer_who_paid_the_whole_bill_can_still_collect_and_correct_each_share(): void
    {
        $this->share();
        $this->organizerPaysEverything();
        $data = $this->getJson($this->url().'?actorId='.$this->host->id)->assertOk()->json();
        self::assertSame(600, $this->member($data, $this->mate->id)['reimbursementOutstanding']);
        self::assertSame(1800, $data['organizer']['outOfPocket']);
        self::assertSame(0, $data['organizer']['reimbursed']);

        $body = ['action' => 'collect', 'actorId' => $this->host->id, 'userId' => $this->mate->id, 'method' => 'Cash at Venue', 'amount' => 600];
        $ledger = $this->postJson($this->url(), $body)->assertOk()->json('ledger');
        self::assertSame(600, $ledger['organizer']['reimbursed']);
        self::assertSame(1200, $ledger['organizer']['reimbursable']);
        self::assertSame(0, $this->member($ledger, $this->mate->id)['reimbursementOutstanding']);
        // A settled share cannot be collected twice.
        $this->postJson($this->url(), $body)->assertStatus(409);

        // The organizer can correct a mistyped amount instead of voiding it.
        $entryId = TeamLedgerEntry::where('booking_id', $this->booking->id)->where('user_id', $this->mate->id)->value('id');
        $fixed = $this->postJson($this->url(), ['action' => 'update', 'actorId' => $this->host->id, 'entryId' => $entryId, 'amount' => 300, 'method' => 'eSewa'])->assertOk()->json('ledger');
        self::assertSame(300, $fixed['organizer']['reimbursed']);
        self::assertSame(300, $this->member($fixed, $this->mate->id)['reimbursementOutstanding']);
        self::assertSame(1500, $fixed['organizer']['reimbursable']);
        // And cannot invent more than the share.
        $this->postJson($this->url(), ['action' => 'update', 'actorId' => $this->host->id, 'entryId' => $entryId, 'amount' => 700])->assertStatus(400);
        self::assertSame(300, (int) TeamLedgerEntry::find($entryId)->amount);
        $this->assertDatabaseHas('booking_payments', ['booking_id' => $this->booking->id, 'amount' => 1800]);
    }

    public function test_teammate_who_paid_the_venue_directly_is_not_collected_again(): void
    {
        $this->share();
        BookingPayment::create([
            'booking_id' => $this->booking->id, 'amount' => 600, 'method' => 'Khalti',
            'source' => 'gateway', 'reference' => 'mate-paid', 'recorded_by' => $this->mate->id,
        ]);
        $this->postJson($this->url(), ['action' => 'collect', 'actorId' => $this->host->id, 'userId' => $this->mate->id, 'method' => 'Cash at Venue', 'amount' => 100])
            ->assertStatus(409);
        self::assertSame(0, TeamLedgerEntry::count());
    }

    public function test_reimbursement_requests_persist_and_never_open_a_gateway(): void
    {
        $this->share();
        $this->organizerPaysEverything();
        $url = '/api/bookings/'.$this->booking->id.'/payment-requests';
        $payload = ['requesterId' => $this->host->id, 'payerIds' => [$this->mate->id], 'amount' => 600, 'purpose' => 'reimbursement'];
        $id = $this->postJson($url, $payload)->assertCreated()->json('paymentRequest.id');
        $this->assertDatabaseHas('booking_payment_requests', ['id' => $id, 'purpose' => 'reimbursement', 'status' => 'pending', 'amount_due' => 600]);
        // Asking for more than the share, or twice, is refused.
        $this->postJson($url, array_replace($payload, ['payerIds' => [$this->host->id]]))->assertStatus(400);
        $this->postJson($url, array_replace($payload, ['amount' => 700, 'payerIds' => [$this->host->id]]))->assertStatus(400);
        // Reimbursements go to the organizer, never through eSewa/Khalti.
        $this->patchJson($url.'/'.$id, ['userId' => $this->mate->id, 'paymentMethod' => 'eSewa'])->assertStatus(409);
        $this->postJson('/api/payments/esewa/verify', ['bookingId' => $this->booking->id, 'userId' => $this->mate->id,
            'paymentRequestId' => $id, 'mockApprove' => true, 'uuid' => 'reimb', 'pidx' => 'mock-reimb'])->assertStatus(409);
        $this->assertDatabaseHas('booking_payment_requests', ['id' => $id, 'status' => 'pending', 'paid_amount' => 0]);
        self::assertSame(1, BookingPayment::count());
        $this->patchJson($url.'/'.$id, ['userId' => $this->host->id, 'action' => 'cancel'])->assertOk();
        $this->assertDatabaseHas('booking_payment_requests', ['id' => $id, 'status' => 'cancelled']);
    }

    public function test_organizer_paid_nothing_so_there_is_nothing_to_reimburse(): void
    {
        $share = $this->share();
        $url = '/api/bookings/'.$this->booking->id.'/payment-requests';
        $this->postJson($url, ['requesterId' => $this->host->id, 'payerIds' => [$this->mate->id], 'amount' => 100, 'purpose' => 'reimbursement'])
            ->assertStatus(409);
        self::assertSame('pending', $share->payment_status);
        self::assertSame(0, BookingPaymentRequest::count());
    }

    public function test_gateway_shares_appear_automatically_without_duplicate_counting(): void
    {
        $this->share(600);
        BookingPayment::create([
            'booking_id' => $this->booking->id, 'amount' => 600, 'method' => 'eSewa',
            'source' => 'gateway', 'reference' => 'txn-one', 'recorded_by' => $this->mate->id,
        ]);
        for ($i = 0; $i < 2; $i++) {
            $data = $this->getJson($this->url().'?actorId='.$this->host->id)->assertOk()->json();
            $mate = $this->member($data, $this->mate->id);
            self::assertSame(600, $mate['collected']);
            self::assertSame(0, $mate['outstanding']);
            self::assertSame('paid', $mate['status']);
            self::assertSame('venue', $mate['entries'][0]['source']);
            self::assertFalse($mate['entries'][0]['canVoid']);
            self::assertSame(600, $data['totals']['collected']);
        }
        self::assertSame(0, TeamLedgerEntry::count());
        self::assertSame(1, BookingPayment::count());
    }

    public function test_void_manual_entry_preserves_gateway_contribution(): void
    {
        $this->share(600);
        BookingPayment::create([
            'booking_id' => $this->booking->id, 'amount' => 400, 'method' => 'Khalti',
            'source' => 'gateway', 'reference' => 'txn-two', 'recorded_by' => $this->mate->id,
        ]);
        $entry = TeamLedgerEntry::create([
            'booking_id' => $this->booking->id, 'team_id' => $this->booking->team_id, 'user_id' => $this->mate->id,
            'amount' => 200, 'method' => 'Cash at Venue', 'recorded_by' => $this->host->id,
        ]);
        for ($i = 0; $i < 2; $i++) {
            $data = $this->postJson($this->url(), ['action' => 'void', 'actorId' => $this->host->id, 'entryId' => $entry->id])->assertOk()->json('ledger');
            self::assertSame(400, $this->member($data, $this->mate->id)['collected']);
            self::assertSame(200, $data['totals']['outstanding']);
        }
        $this->assertDatabaseHas('booking_team_payments', ['user_id' => $this->mate->id, 'paid_amount' => 400]);
        self::assertNotNull($entry->fresh()->voided_at);
    }

    public function test_open_spot_players_and_payments_are_listed_without_a_team(): void
    {
        $this->booking->forceFill(['team_id' => null, 'visibility' => 'public'])->save();
        $match = OpenMatch::create([
            'title' => 'Open game', 'booking_id' => $this->booking->id, 'court_id' => $this->booking->court_id,
            'venue_id' => $this->booking->court->venue_id, 'organizer_id' => $this->host->id,
            'date' => $this->booking->date, 'start_time' => '18:00', 'end_time' => '19:00',
            'price_per_player' => 300, 'max_players' => 10,
        ]);
        MatchJoin::create(['match_id' => $match->id, 'user_id' => $this->outsider->id, 'status' => 'accepted',
            'paid_amount' => 300, 'pay_method' => 'eSewa', 'payment_ref' => 'spot-txn', 'paid_at' => now()]);
        MatchJoin::create(['match_id' => $match->id, 'user_id' => $this->mate->id, 'status' => 'accepted']);
        $data = $this->getJson($this->url().'?actorId='.$this->host->id)->assertOk()->json();
        self::assertSame('open_spot', $this->member($data, $this->outsider->id)['entries'][0]['source']);
        self::assertSame('accepted', $this->member($data, $this->mate->id)['openSpots'][0]['status']);
        self::assertSame(300, $this->member($data, $this->mate->id)['outstanding']);
        self::assertSame(300, $data['totals']['collected']);
        // Open players cannot browse the whole team's private ledger.
        $this->getJson($this->url().'?actorId='.$this->outsider->id)->assertStatus(403);
        self::assertSame(0, BookingPayment::count());
    }

    public function test_guest_entries_persist_without_fake_accounts_or_venue_receipts(): void
    {
        $count = User::count();
        $this->share();
        $body = ['action' => 'guest', 'actorId' => $this->host->id, 'playerName' => 'Walk-in player', 'method' => 'Cash at Venue', 'amount' => 500];
        $id = $this->postJson($this->url(), $body)->assertCreated()->json('entryId');
        $data = $this->getJson($this->url().'?actorId='.$this->host->id)->assertOk()->json();
        self::assertSame('Walk-in player', $data['guests'][0]['playerName']);
        self::assertSame(500, $data['totals']['guestCollected']);
        self::assertSame(600, $data['totals']['outstanding']);
        self::assertSame($count, User::count());
        self::assertSame(0, BookingPayment::count());
        $this->postJson($this->url(), ['action' => 'voidGuest', 'actorId' => $this->host->id, 'entryId' => $id])
            ->assertOk()->assertJsonPath('ledger.totals.guestCollected', 0);
        self::assertNotNull(BookingGuestPayment::findOrFail($id)->voided_at);
        self::assertSame(1, BookingGuestPayment::count());
    }

    public function test_guest_writes_are_validated_and_organizer_only(): void
    {
        $body = ['action' => 'guest', 'actorId' => $this->host->id, 'playerName' => 'Guest', 'method' => 'Khalti', 'amount' => 100];
        $this->postJson($this->url(), array_replace($body, ['actorId' => $this->mate->id]))->assertStatus(403);
        foreach ([['playerName' => ' '], ['amount' => 10.5], ['amount' => -1], ['method' => 'Other']] as $invalid) {
            $this->postJson($this->url(), array_replace($body, $invalid))->assertStatus(400);
        }
        self::assertSame(0, BookingGuestPayment::count());
    }

    public function test_startup_schema_check_is_safe_to_repeat_with_existing_guest_data(): void
    {
        $this->postJson($this->url(), ['action' => 'guest', 'actorId' => $this->host->id, 'playerName' => 'Guest', 'method' => 'Khalti', 'amount' => 100])->assertCreated();
        app(StartupSchema::class)->ensure(new BufferedOutput);
        app(StartupSchema::class)->ensure(new BufferedOutput);
        self::assertSame(1, BookingGuestPayment::count());
    }
}
