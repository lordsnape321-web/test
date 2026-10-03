<?php

namespace Tests\Feature;

use App\Models\Court;
use App\Models\User;
use App\Models\Venue;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Per-court opening hours.
 *
 * A court may keep its own window; without one it follows the venue's
 * `opening_hour`/`closing_hour`, which is what every court did before these
 * columns existed. The important half is the second one: the venue's hours were
 * only ever decoration, so a game could be booked at 03:00 and then cancelled
 * by the owner. Those are now refused at creation.
 */
class CourtHoursTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $player;
    private Venue $venue;

    protected function setUp(): void
    {
        parent::setUp();
        $this->owner = User::create(['name' => 'Owner', 'email' => 'owner@test.example', 'role' => 'owner']);
        $this->player = User::create(['name' => 'Player', 'email' => 'player@test.example']);
        $this->venue = Venue::create([
            'name' => 'Test Venue',
            'address' => 'Kathmandu',
            'owner_id' => $this->owner->id,
            'opening_hour' => 6,
            'closing_hour' => 22,
        ]);
    }

    private function addCourt(string $name, ?string $opensAt, ?string $closesAt): int
    {
        return $this->postJson('/api/courts', [
            'venueId' => $this->venue->id,
            'ownerId' => $this->owner->id,
            'name' => $name,
            'pricePerHour' => 1700,
            'opensAt' => $opensAt,
            'closesAt' => $closesAt,
        ])->assertCreated()->json('court.id');
    }

    private function book(int $courtId, string $startTime, int $hours = 1)
    {
        return $this->bookOn($courtId, now()->addDays(2)->toDateString(), $startTime, $hours);
    }

    private function bookOn(int $courtId, string $date, string $startTime, int $hours = 1)
    {
        return $this->postJson('/api/bookings', [
            'courtId' => $courtId,
            'userId' => $this->player->id,
            'date' => $date,
            'startTime' => $startTime,
            'durationHours' => $hours,
        ]);
    }

    /** The next Friday, inside the app's booking horizon and in the future. */
    private function nextFriday(): string
    {
        return now()->addDay()->next('Friday')->toDateString();
    }

    public function test_a_court_keeps_the_hours_the_owner_gave_it(): void
    {
        $id = $this->addCourt('Early bird', '05:30', '23:00');

        $court = Court::find($id);
        self::assertSame('05:30', $court->opens_at);
        self::assertSame('23:00', $court->closes_at);
        // The app reads camelCase keys off the wire.
        self::assertSame('05:30', $court->toArray()['opensAt']);
    }

    public function test_hours_are_all_or_nothing_and_must_move_forward(): void
    {
        // Only one side of the pair.
        $this->postJson('/api/courts', [
            'venueId' => $this->venue->id, 'ownerId' => $this->owner->id,
            'name' => 'Half open', 'opensAt' => '06:00',
        ])->assertStatus(400);

        // Closing at or before opening.
        $this->postJson('/api/courts', [
            'venueId' => $this->venue->id, 'ownerId' => $this->owner->id,
            'name' => 'Backwards', 'opensAt' => '22:00', 'closesAt' => '06:00',
        ])->assertStatus(400);

        // Not a clock value at all.
        $this->postJson('/api/courts', [
            'venueId' => $this->venue->id, 'ownerId' => $this->owner->id,
            'name' => 'Nonsense', 'opensAt' => '25:00', 'closesAt' => '26:00',
        ])->assertStatus(400);
    }

    public function test_blank_hours_on_an_edit_fall_back_to_the_venue(): void
    {
        $id = $this->addCourt('Flexible', '05:00', '23:00');

        $this->patchJson("/api/courts/{$id}", [
            'ownerId' => $this->owner->id,
            'opensAt' => '',
            'closesAt' => '',
        ])->assertOk();

        $court = Court::find($id)->fresh();
        self::assertNull($court->opens_at);
        self::assertNull($court->closes_at);
    }

    public function test_a_court_without_its_own_hours_follows_the_venue(): void
    {
        $id = $this->addCourt('Standard', null, null);

        $this->book($id, '10:00')->assertCreated();
        $this->book($id, '06:00')->assertCreated();

        // Before the venue opens.
        $early = $this->book($id, '05:00')->assertStatus(400);
        self::assertStringContainsString('is open 06:00', (string) $early->json('error'));

        // A 22:00 start would end an hour after the venue shut.
        $late = $this->book($id, '22:00')->assertStatus(400);
        self::assertStringContainsString('is open 06:00', (string) $late->json('error'));
    }

    public function test_a_court_can_be_booked_only_inside_its_own_window(): void
    {
        $id = $this->addCourt('Nighter', '18:00', '23:00');

        $this->book($id, '18:00')->assertCreated();
        $this->book($id, '21:00')->assertCreated();

        // Inside the venue's hours, outside this court's.
        $morning = $this->book($id, '09:00')->assertStatus(400);
        self::assertStringContainsString('is open 18:00', (string) $morning->json('error'));
    }

    public function test_a_longer_block_must_fit_inside_the_window(): void
    {
        $id = $this->addCourt('Late', '18:00', '22:00');

        $this->book($id, '20:00', 2)->assertCreated();
        // 21:00 + 2h would end at 23:00, an hour after this court shuts.
        $this->book($id, '21:00', 2)->assertStatus(400);
    }

    public function test_a_weekday_can_keep_its_own_hours(): void
    {
        $id = $this->postJson('/api/courts', [
            'venueId' => $this->venue->id,
            'ownerId' => $this->owner->id,
            'name' => 'Friday nighter',
            'pricePerHour' => 1700,
            'opensAt' => '06:00',
            'closesAt' => '22:00',
            'dayHours' => [
                ['dayOfWeek' => 5, 'opensAt' => '18:00', 'closesAt' => '23:00'],
            ],
        ])->assertCreated()->json('court');

        self::assertSame(5, $court['dayHours'][0]['dayOfWeek']);
        self::assertSame('18:00', $court['dayHours'][0]['opensAt']);
    }

    public function test_a_weekday_override_must_be_a_complete_window(): void
    {
        // Half a window is a mistake, not "open from 18:00".
        $this->postJson('/api/courts', [
            'venueId' => $this->venue->id, 'ownerId' => $this->owner->id,
            'name' => 'Half day', 'opensAt' => '06:00', 'closesAt' => '22:00',
            'dayHours' => [['dayOfWeek' => 5, 'opensAt' => '18:00']],
        ])->assertStatus(400);

        // And a weekday that does not exist is not a day.
        $this->postJson('/api/courts', [
            'venueId' => $this->venue->id, 'ownerId' => $this->owner->id,
            'name' => 'Day nine', 'opensAt' => '06:00', 'closesAt' => '22:00',
            'dayHours' => [['dayOfWeek' => 9, 'opensAt' => '18:00', 'closesAt' => '23:00']],
        ])->assertStatus(400);
    }

    public function test_the_booking_window_follows_the_weekday_override(): void
    {
        $id = $this->postJson('/api/courts', [
            'venueId' => $this->venue->id,
            'ownerId' => $this->owner->id,
            'name' => 'Friday nighter',
            'pricePerHour' => 1700,
            'opensAt' => '06:00',
            'closesAt' => '22:00',
            'dayHours' => [
                ['dayOfWeek' => 5, 'opensAt' => '18:00', 'closesAt' => '23:00'],
            ],
        ])->assertCreated()->json('court.id');

        $friday = $this->nextFriday();

        // 09:00 is inside the court's usual hours, outside its Friday window.
        $morning = $this->bookOn($id, $friday, '09:00')->assertStatus(400);
        self::assertStringContainsString('18:00', (string) $morning->json('error'));
        self::assertStringContainsString('Fridays', (string) $morning->json('error'));

        // 19:00 only works on the Friday override, and 23:00 is its close.
        $this->bookOn($id, $friday, '19:00')->assertCreated();
        $this->bookOn($id, $friday, '22:00')->assertCreated();
        $this->bookOn($id, $friday, '23:00')->assertStatus(400);

        // The other six days still open at 06:00.
        $saturday = now()->addDay()->next('Saturday')->toDateString();
        $this->bookOn($id, $saturday, '09:00')->assertCreated();
    }

    public function test_an_edit_replaces_the_weekday_overrides(): void
    {
        $id = $this->postJson('/api/courts', [
            'venueId' => $this->venue->id, 'ownerId' => $this->owner->id,
            'name' => 'Swap days', 'opensAt' => '06:00', 'closesAt' => '22:00',
            'dayHours' => [['dayOfWeek' => 5, 'opensAt' => '18:00', 'closesAt' => '23:00']],
        ])->assertCreated()->json('court.id');

        // Monday now has its own window; Friday's old one is gone.
        $court = $this->patchJson("/api/courts/{$id}", [
            'ownerId' => $this->owner->id,
            'dayHours' => [['dayOfWeek' => 1, 'opensAt' => '17:00', 'closesAt' => '22:30']],
        ])->assertOk()->json('court');

        self::assertCount(1, $court['dayHours']);
        self::assertSame(1, $court['dayHours'][0]['dayOfWeek']);
        self::assertSame('17:00', $court['dayHours'][0]['opensAt']);

        // An empty list clears every override.
        $court = $this->patchJson("/api/courts/{$id}", [
            'ownerId' => $this->owner->id,
            'dayHours' => [],
        ])->assertOk()->json('court');

        self::assertSame([], $court['dayHours']);
    }

    public function test_the_owner_can_save_and_clear_a_venue_map_link(): void
    {
        $saved = $this->patchJson("/api/venues/{$this->venue->id}", [
            'ownerId' => $this->owner->id,
            'locationUrl' => 'https://maps.app.goo.gl/abc123',
        ])->assertOk()->json('venue');

        self::assertSame('https://maps.app.goo.gl/abc123', $saved['locationUrl']);

        // Blank clears it: the app then opens Maps on the address instead.
        $cleared = $this->patchJson("/api/venues/{$this->venue->id}", [
            'ownerId' => $this->owner->id,
            'locationUrl' => '',
        ])->assertOk()->json('venue');

        self::assertSame('', $cleared['locationUrl']);
    }
}
