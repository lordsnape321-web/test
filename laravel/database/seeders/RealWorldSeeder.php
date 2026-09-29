<?php

namespace Database\Seeders;

use App\Models\Booking;
use App\Models\BookingExtra;
use App\Models\BookingPayment;
use App\Models\BookingPaymentRequest;
use App\Models\BookingTeamPayment;
use App\Models\Court;
use App\Models\MatchJoin;
use App\Models\Notification;
use App\Models\OpenMatch;
use App\Models\Promo;
use App\Models\Review;
use App\Models\Team;
use App\Models\TeamInvite;
use App\Models\TeamMember;
use App\Models\TeamRequest;
use App\Models\Tournament;
use App\Models\TournamentMatch;
use App\Models\TournamentMedia;
use App\Models\TournamentPayment;
use App\Models\TournamentTeam;
use App\Models\User;
use App\Models\Venue;
use App\Models\Voucher;
use App\Support\Futsal;
use App\Support\League;
use App\Support\LegacyPassword;
use App\Support\Loyalty;
use App\Support\OpenGames;
use App\Support\Promos;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * A deterministic Nepal futsal world for local development.
 *
 * This intentionally lives outside a controller. `db:seed` and `/api/seed` use
 * the same transaction, the same fixtures and the same repeatability guard.
 * The first run creates the full connected world; later runs return its report
 * without adding duplicate rows. For a clean replacement of an older local
 * fixture, run `php artisan migrate:fresh --seed`.
 */
class RealWorldSeeder extends Seeder
{
    private const VERSION = 'nepal-real-world-2026-09';

    private const MARKER_VENUE = 'Satdobato Sports Village';

    private const DEFAULT_PASSWORD = 'futsal123';

    /**
     * Who plays for whom, filled in by createTeams().
     *
     * A booking may only carry a squad the booker actually belongs to — the
     * API rejects anything else — so the seeder keeps its own map instead of
     * pairing a random player with a random team.
     *
     * @var array<int, list<int>>
     */
    private array $rosters = [];

    /** @var array<int, list<int>> user id => the teams they play for */
    private array $teamsByPlayer = [];

    /**
     * "court|date|start" keys already written, so no two seeded games sit in
     * the same slot on the same pitch. The API rejects overlaps outright.
     *
     * @var array<string, true>
     */
    private array $takenSlots = [];

    /**
     * Courts that are out of service. History keeps pointing at them, but no
     * new booking may land on one.
     *
     * @var array<int, true>
     */
    private array $retiredCourts = [];

    /**
     * A player's bookings as they are written, so the next one is judged by
     * the same rating rule the API uses instead of a made-up number.
     *
     * @var array<int, list<Booking>>
     */
    private array $playerHistory = [];

    /**
     * Which player has spent which code, because a seeded code is limited to
     * one use per player and the bill has to respect that.
     *
     * @var array<string, true>
     */
    private array $promoUses = [];

    /**
     * Create the dataset once and return a useful report to both CLI and HTTP.
     *
     * @return array<string, mixed>
     */
    public function run(): array
    {
        if (Venue::where('name', self::MARKER_VENUE)->exists()) {
            return $this->report('already_present');
        }

        return DB::transaction(function (): array {
            Model::unguard();

            try {
                $users = $this->createUsers();
                $grounds = $this->createVenues($users['owners']);
                $teams = $this->createTeams($users['players'], $grounds['venues']);
                $this->createTeamQueues($teams, $users['players']);
                $leagues = $this->createTournaments(
                    $teams,
                    $grounds['venues'],
                    $grounds['courts'],
                    $users['owners'],
                    $users['players']
                );
                // Promos and vouchers are made before the bookings, because a
                // booking is the row where a code or a free hour is actually
                // spent — the voucher only exists once something has used it.
                $promos = $this->createPromos($grounds['venues']);
                $vouchers = $this->createVouchers($users['players'], $grounds['venues']);
                $bookings = $this->createBookings(
                    $users,
                    $teams,
                    $grounds['venues'],
                    $grounds['courts'],
                    $leagues,
                    $promos,
                    $vouchers
                );
                $this->createTournamentFixtures(
                    $leagues,
                    $teams,
                    $grounds['courts'],
                    $bookings['fixtureBookings']
                );
                $this->createOpenMatches(
                    $users['players'],
                    $grounds['venues'],
                    $grounds['courts'],
                    $bookings['public']
                );
                $this->createReviews($users['players'], $grounds['venues'], $grounds['courts'], $bookings['completed']);
                $this->createNotifications($users, $teams, $leagues, $bookings);
            } finally {
                Model::reguard();
            }

            return $this->report('created');
        }, 3);
    }

    /**
     * @return array{owners: list<User>, players: list<User>}
     */
    private function createUsers(): array
    {
        $ownerRows = [
            ['Prabin Shakya', 'prabin.shakya@futsal.np', '9801001001', 'Kathmandu'],
            ['Sita Maharjan', 'sita.maharjan@futsal.np', '9818012002', 'Lalitpur'],
            ['Nabin Joshi', 'nabin.joshi@futsal.np', '9823013003', 'Kathmandu'],
            ['Ramesh Dangol', 'ramesh.dangol@futsal.np', '9803014004', 'Bhaktapur'],
            ['Manisha Karki', 'manisha.karki@futsal.np', '9841015005', 'Kathmandu'],
            ['Kamal Gurung', 'kamal.gurung@futsal.np', '9860016006', 'Pokhara'],
            ['Sushil Bhandari', 'sushil.bhandari@futsal.np', '9814017007', 'Chitwan'],
            ['Rojina Shrestha', 'rojina.shrestha@futsal.np', '9849018008', 'Lalitpur'],
            ['Bikash Maharjan', 'bikash.maharjan@futsal.np', '9808019009', 'Kathmandu'],
            ['Sarita Rai', 'sarita.rai@futsal.np', '9861020010', 'Kathmandu'],
            ['Anil Poudel', 'anil.poudel@futsal.np', '9811021011', 'Chitwan'],
            ['Sunita Thapa', 'sunita.thapa@futsal.np', '9841022012', 'Pokhara'],
            ['Niraj Kafle', 'niraj.kafle@futsal.np', '9801023013', 'Bhaktapur'],
            ['Pema Lama', 'pema.lama@futsal.np', '9818024014', 'Lalitpur'],
            ['Rakesh Adhikari', 'rakesh.adhikari@futsal.np', '9823025015', 'Kathmandu'],
            ['Mina Gurung', 'mina.gurung@futsal.np', '9849026016', 'Pokhara'],
            ['Roshan Shahi', 'roshan.shahi@futsal.np', '9860027017', 'Kathmandu'],
            ['Binod Koirala', 'binod.koirala@futsal.np', '9803028018', 'Chitwan'],
        ];

        $playersNames = [
            'Aayush Adhikari', 'Sagar Shrestha', 'Nischal Gurung', 'Rojan Karki',
            'Bibek Thapa', 'Sujan Rai', 'Anish Maharjan', 'Prakash Tamang',
            'Roshan Bista', 'Milan Lama', 'Sandesh Poudel', 'Kiran KC',
            'Abhishek Basnet', 'Saurav Bhattarai', 'Suman Rijal', 'Dipesh Khadka',
            'Nirajan Shahi', 'Samir Kunwar', 'Rajan Gautam', 'Ritesh Joshi',
            'Utsav Neupane', 'Aashish Ghimire', 'Bimal Gurung', 'Nabin Magar',
            'Sabin Limbu', 'Alok Gurung', 'Manish Dangol', 'Sunil Shrestha',
            'Bibek Bhandari', 'Nimesh Regmi', 'Yubraj Panta', 'Anup Dhakal',
            'Saroj Oli', 'Prabin Kafle', 'Ramesh Baniya', 'Sudeep Tiwari',
            'Ishan Koirala', 'Rijan Shakya', 'Bikram Khadka', 'Aviral Pokharel',
            'Aayushman Rana', 'Nischal Joshi', 'Sujal Thapa', 'Sushant Giri',
            'Rohan Shrestha', 'Ashim Bhujel', 'Srijan Adhikari', 'Ujjwal Malla',
            'Nitesh Tamang', 'Arjun Lama', 'Saurav Bhandari', 'Bikas Khatri',
            'Sabin Shrestha', 'Nischay Bista', 'Aakash Gurung', 'Pujan Rai',
            'Aashutosh Karki', 'Kshitiz Poudel', 'Shashank Shah', 'Anmol Basnet',
            'Ayush Kandel', 'Dipen Gurung', 'Samyak Maharjan', 'Nirav Khadka',
            'Suyog Bista', 'Bibash Rai', 'Eshan Tamang', 'Prajwal Shahi',
            'Ashish Shrestha', 'Nischal Baniya', 'Rishav Koirala', 'Pratham Joshi',
            'Nirajan Poudel', 'Samip Thapa', 'Ronit Shakya', 'Bishal Magar',
            'Kunal Adhikari', 'Anuj Karki', 'Ritesh Gurung', 'Suyash Regmi',
            'Suman Thapa', 'Sandeep Kafle', 'Nabin Shrestha', 'Roshan Gurung',
            'Manav Pokharel', 'Riwaj Bista', 'Shreyan Limbu', 'Dipson Rana',
            'Rajiv Dangol', 'Aayush Khatri', 'Abhinav Ghimire', 'Sushan Poudel',
            'Pranish Gautam', 'Ujjwal Shrestha', 'Sushil Neupane', 'Kabir Shah',
            'Yogen Tamang', 'Bibek Shakya', 'Sagar Kafle', 'Nischal Basnet',
            'Anish Koirala', 'Roshan Rai', 'Sameer Bhandari', 'Kiran Panta',
            'Biplav Khadka', 'Sandip Gurung', 'Aayush Giri', 'Suraj Magar',
            'Utsab Bhattarai', 'Prasiddha Shrestha', 'Srijan Karki', 'Keshav Joshi',
            'Sudeep Bista', 'Aayush Rijal', 'Hemant Adhikari', 'Nimesh Tamang',
            'Bibas Khatri', 'Pratik Shrestha', 'Aviraj Koirala', 'Bhuvan Rana',
        ];

        $owners = [];

        foreach ($ownerRows as $index => [$name, $email, $phone, $city]) {
            $owners[] = User::firstOrCreate(
                ['email' => $email],
                [
                    'name' => $name,
                    'phone' => $phone,
                    'password_hash' => LegacyPassword::hash(self::DEFAULT_PASSWORD),
                    'role' => 'owner',
                    'avatar_color' => $this->colors[$index % count($this->colors)],
                    'default_city' => $city,
                    'level' => 'Advanced',
                    'position' => 'Owner',
                    'matches_played' => 0,
                    'trust_score' => 98 - ($index % 5),
                ]
            );
        }

        $players = [];
        $cities = Futsal::CITIES;
        $levels = ['Beginner', 'Intermediate', 'Intermediate', 'Advanced'];
        $positions = ['Goalkeeper', 'Defender', 'Midfielder', 'Winger', 'Striker', 'All-rounder', 'Pivot'];

        foreach ($playersNames as $index => $name) {
            // Dotted like the owner addresses, so the "Try as Player" demo
            // account documented in the README and the report below actually
            // exists: aayush.adhikari@futsal.np. The index keeps the rest
            // unique even if two names ever slug to the same string.
            $email = Str::slug($name, '.').($index === 0 ? '' : '.'.$index).'@futsal.np';
            $players[] = User::firstOrCreate(
                ['email' => $email],
                [
                    'name' => $name,
                    'phone' => '98'.str_pad((string) (10000000 + $index * 731), 8, '0', STR_PAD_LEFT),
                    'password_hash' => LegacyPassword::hash(self::DEFAULT_PASSWORD),
                    'role' => 'player',
                    'avatar_color' => $this->colors[($index + 3) % count($this->colors)],
                    'default_city' => $cities[$index % count($cities)],
                    'level' => $levels[$index % count($levels)],
                    'position' => $positions[$index % count($positions)],
                    'matches_played' => 3 + (($index * 7) % 42),
                    // Most regulars sit in the high eighties; a band of them sit
                    // under 70 because they cancel more than they turn up, and
                    // that is what puts the fair-play deposit in front of a
                    // player at the booking screen.
                    'trust_score' => $index % 11 === 5 ? 52 + ($index % 12) : 86 + ($index % 15),
                ]
            );
        }

        return ['owners' => $owners, 'players' => $players];
    }

    /** @var list<string> */
    private array $colors = [
        '#0f766e', '#1d4ed8', '#b45309', '#be123c', '#7c3aed', '#047857',
        '#0369a1', '#c2410c', '#4338ca', '#15803d', '#a21caf', '#b91c1c',
    ];

    /**
     * @param  list<User>  $owners
     * @return array{venues: list<Venue>, courts: list<Court>}
     */
    private function createVenues(array $owners): array
    {
        $venueRows = [
            [
                'Satdobato Sports Village', 'Ring Road, Satdobato, Lalitpur', 'Lalitpur', '01-5912468', 0,
                'A covered five-a-side ground beside the Satdobato sports corridor, with a bright evening pitch and a small tea counter for teams waiting between games.',
                5, 22, true, 30, ['Himalayan Turf', 'Valley Court', 'Training Box'], 1800,
            ],
            [
                'Bhaisepati Sports Village', 'Bhaisepati Height, Lalitpur', 'Lalitpur', '01-5591432', 1,
                'Quiet neighbourhood turf with easy scooter parking, clean changing rooms and a Sunday morning slot that regular families book weeks ahead.',
                6, 22, true, 25, ['Main Arena', 'Garden Court'], 1700,
            ],
            [
                'Jhamsikhel Kick House', 'Jhamsikhel Road, Lalitpur', 'Lalitpur', '9801122334', 7,
                'A compact Jhamsikhel ground made for quick after-work games. The owner keeps the ball rack, bibs and first-aid kit ready at reception.',
                6, 23, false, 35, ['Kick House One', 'Kick House Two'], 1900,
            ],
            [
                'Sankhamul Riverside Futsal', 'Sankhamul, Kathmandu', 'Kathmandu', '01-4782201', 2,
                'Riverside five-a-side pitches used by office leagues from New Baneshwor and Patan. Floodlights stay on late for the 9 pm crowd.',
                6, 23, true, 30, ['River Pitch', 'Bridge Pitch', 'Riverside Mini'], 1900,
            ],
            [
                'Baneshwor Futsal Hub', 'Shantinagar, New Baneshwor, Kathmandu', 'Kathmandu', '9818123456', 4,
                'A busy central venue with proper warm-up space, a water refill station and short walk-in games for players who do not have a full squad.',
                6, 22, false, 30, ['Hub A', 'Hub B'], 1600,
            ],
            [
                'Chabahil United Futsal', 'Chuchepati, Chabahil, Kathmandu', 'Kathmandu', '9808765432', 8,
                'A well-lit local ground near Chabahil where college teams share the pitch with long-running neighbourhood sides.',
                5, 22, true, 25, ['United Main', 'United Annex', 'United Skills'], 1650,
            ],
            [
                'Koteshwor Sports Arena', 'Tinkune-Koteshwor, Kathmandu', 'Kathmandu', '01-4990876', 9,
                'Three hard-wearing artificial courts, a covered spectator strip and practical late-night access from the Ring Road.',
                6, 23, false, 35, ['Tinkune Turf', 'Koteshwor Turf', 'Arena Court'], 1750,
            ],
            [
                'Baluwatar City Futsal', 'Baluwatar, Kathmandu', 'Kathmandu', '9841223344', 14,
                'A central city venue with a calm weekday atmosphere, reliable floodlights and a small counter serving chiya and momo after games.',
                6, 22, false, 30, ['City Main', 'City Practice'], 1850,
            ],
            [
                'Maharajgunj Futsal Club', 'Teaching Hospital Road, Maharajgunj, Kathmandu', 'Kathmandu', '9815667788', 16,
                'Club-style facilities near Maharajgunj with a broad pitch, secure parking and regular medical-college fixtures.',
                5, 22, true, 25, ['Club Pitch', 'North Court'], 1900,
            ],
            [
                'Tokha Turf House', 'Grande Road, Tokha, Kathmandu', 'Kathmandu', '9804556677', 17,
                'A newer Tokha ground with a forgiving surface and flexible slots for school groups, women\'s sides and evening leagues.',
                6, 22, false, 20, ['Tokha One', 'Tokha Two'], 1550,
            ],
            [
                'Suryabinayak Futsal Park', 'Suryabinayak Chowk, Bhaktapur', 'Bhaktapur', '9849001122', 3,
                'Open-air pitches with a view toward the hills, popular for Saturday tournaments and teams travelling from Thimi and Banepa.',
                6, 21, true, 30, ['Park Main', 'Park Side', 'Park Training'], 1500,
            ],
            [
                'Thimi Community Futsal', 'Madhyapur Thimi, Bhaktapur', 'Bhaktapur', '9812334455', 12,
                'A friendly community ground that keeps prices approachable for youth clubs and reserves one court for local school programmes.',
                6, 21, false, 20, ['Community One', 'Community Two'], 1350,
            ],
            [
                'Dattatreya Goalpost', 'Byasi, Bhaktapur', 'Bhaktapur', '9803445566', 13,
                'A small two-court venue close to the old city, known for tight games, patient coaching and a good supply of match balls.',
                7, 21, false, 25, ['Dattatreya Main', 'Dattatreya Court'], 1400,
            ],
            [
                'Lakeside Futsal Arena', 'Khahare, Lakeside, Pokhara', 'Pokhara', '061-466901', 5,
                'A tourist-town arena where local clubs and travelling groups share a clean pitch after sunset, with lockers and a café upstairs.',
                6, 23, true, 30, ['Lakeside Arena', 'Phewa Court', 'Mountain Court'], 2000,
            ],
            [
                'Damside Sports Court', 'Damside, Pokhara', 'Pokhara', '9806112233', 11,
                'A practical Damside venue for regular leagues, with a covered bench and a wide entrance for team vans and equipment.',
                6, 22, false, 25, ['Damside Main', 'Damside Side'], 1750,
            ],
            [
                'Birauta Futsal Club', 'Birauta, Pokhara', 'Pokhara', '9816223344', 15,
                'Neighbourhood club with evening coaching for teenagers, dependable turf and a quiet corner for keeping boots and bags.',
                6, 22, false, 30, ['Birauta Club', 'Birauta Mini'], 1600,
            ],
            [
                'Bharatpur Central Futsal', 'Hakim Chowk, Bharatpur, Chitwan', 'Chitwan', '056-493210', 6,
                'A busy central Chitwan venue with roomy changing areas and a calendar that mixes corporate games with district-level youth fixtures.',
                5, 22, true, 30, ['Central Main', 'Central North', 'Central South'], 1500,
            ],
            [
                'Narayangarh Sports Park', 'Narayangarh, Chitwan', 'Chitwan', '9805011223', 10,
                'Spacious grounds for weekend events and open games, with a shaded spectator area and a helpful caretaker on every shift.',
                6, 21, false, 25, ['Narayangarh One', 'Narayangarh Two'], 1450,
            ],
            [
                'Buddha Chowk Futsal', 'Buddha Chowk, Bharatpur, Chitwan', 'Chitwan', '9817334455', 6,
                'A lively local pitch near the market, especially popular with hospital and campus teams on weekday evenings.',
                6, 22, false, 30, ['Buddha Main', 'Buddha Practice'], 1450,
            ],
            [
                'Patan Dhoka Futsal Studio', 'Patan Dhoka, Lalitpur', 'Lalitpur', '9848112233', 1,
                'A smaller studio court for technical sessions and five-a-side games, with excellent lighting and a strict no-outdoor-shoes policy.',
                6, 22, false, 35, ['Patan Studio', 'Patan Skills'], 1850,
            ],
        ];

        $venues = [];
        $courts = [];
        $surfaceNames = ['Premium artificial turf', 'FIFA-style synthetic turf', 'Indoor synthetic turf', 'Shock-pad artificial turf'];

        foreach ($venueRows as $index => $row) {
            [$name, $address, $city, $phone, $ownerIndex, $description, $opening, $closing, $featured, $deposit, $courtNames, $basePrice] = $row;
            $venue = Venue::firstOrCreate(
                ['name' => $name],
                [
                    'address' => $address,
                    'city' => $city,
                    'phone' => $phone,
                    'description' => $description,
                    'image_url' => Futsal::VENUE_IMAGES[$index % count(Futsal::VENUE_IMAGES)],
                    'rating' => 4.35 + (($index * 7) % 60) / 100,
                    'total_reviews' => 12 + (($index * 11) % 47),
                    'opening_hour' => $opening,
                    'closing_hour' => $closing,
                    'amenities' => $index % 3 === 0
                        ? 'Parking,Changing Room,Shower,WiFi,Cafeteria,First Aid'
                        : 'Parking,Changing Room,Drinking Water,First Aid,Floodlights',
                    'is_featured' => $featured,
                    'accepted_payments' => $index % 4 === 0 ? 'eSewa,Khalti,Cash at Venue' : 'eSewa,Cash at Venue',
                    'deposit_percent' => $deposit,
                    'default_extra_fee' => $index % 5 === 0 ? 150 : 0,
                    'default_extra_fee_note' => $index % 5 === 0 ? 'Bib and match-ball hire' : '',
                    'owner_id' => $owners[$ownerIndex]->id,
                ]
            );
            $venues[] = $venue;

            $venueCourts = [];

            foreach ($courtNames as $courtIndex => $courtName) {
                // Two pitches are mid-resurfacing. Their row stays for history —
                // old bookings still point at them — but the app hides a court
                // with `deleted_at`, which is the one scenario a "make new"
                // seeder can otherwise never show.
                $retired = ($index === 2 && $courtIndex === 1) || ($index === 16 && $courtIndex === 2);

                $court = Court::firstOrCreate(
                    ['venue_id' => $venue->id, 'name' => $courtName],
                    [
                        'format' => $courtIndex === 2 ? '6v6' : '5v5',
                        'surface' => $surfaceNames[($index + $courtIndex) % count($surfaceNames)],
                        'price_per_hour' => $basePrice + ($courtIndex * 100),
                        'price_morning' => max(1000, $basePrice - 250 + ($courtIndex * 50)),
                        'image_url' => Futsal::VENUE_IMAGES[($index + $courtIndex + 2) % count(Futsal::VENUE_IMAGES)],
                        'is_active' => ! $retired,
                        'deleted_at' => $retired ? now()->subMonths(2) : null,
                    ]
                );

                if ($retired) {
                    $this->retiredCourts[(int) $court->id] = true;
                }

                $venueCourts[] = $court;
                $courts[] = $court;
            }
        }

        return ['venues' => $venues, 'courts' => $courts];
    }

    /**
     * @param  list<User>  $players
     * @param  list<Venue>  $venues
     * @return list<Team>
     */
    private function createTeams(array $players, array $venues): array
    {
        $teamRows = [
            ['Satdobato Strikers', 'Quick feet, quiet confidence', 'Advanced', '#0f766e', 0, 'A Thursday night side that likes short passing and never skips the warm-up.'],
            ['Kathmandu City Eleven', 'Own the middle', 'Advanced', '#1d4ed8', 3, 'A mixed office-and-college squad built around calm midfield play and hard running.'],
            ['Lalitpur Legends', 'Earn every yard', 'Advanced', '#b45309', 1, 'Long-time friends from Patan who still make room for a new defender when the roster is short.'],
            ['Himalayan Hustlers', 'Run together', 'Intermediate', '#7c3aed', 13, 'A young Lalitpur group balancing university fixtures with a serious Saturday league habit.'],
            ['Chabahil Chargers', 'One more pass', 'Advanced', '#be123c', 5, 'Fast on the counter and usually first to organise a late evening game around Chabahil.'],
            ['Baneshwor Blue Stars', 'Blue shirts, big lungs', 'Intermediate', '#0369a1', 4, 'A reliable New Baneshwor group with a goalkeeper rotation and a good post-match tea ritual.'],
            ['Bhaktapur Bhailas', 'Local roots, open game', 'Intermediate', '#c2410c', 10, 'A Bhaktapur neighbourhood team that mixes experienced players with energetic school alumni.'],
            ['Thimi Town FC', 'Keep it simple', 'Beginner', '#15803d', 11, 'A welcoming side for players learning organised five-a-side football in Madhyapur Thimi.'],
            ['Phewa Lake Rovers', 'Play the view', 'Advanced', '#4338ca', 13, 'Pokhara regulars who press high, travel light and book their lakeside court early.'],
            ['Damside Dynamos', 'No easy minutes', 'Advanced', '#a21caf', 14, 'A Damside league team with a compact shape and a habit of turning close games late.'],
            ['Birauta Falcons', 'Rise after mistakes', 'Intermediate', '#047857', 15, 'A friendly Pokhara side that keeps matches competitive without losing the community feel.'],
            ['Chitwan Cheetahs', 'Fast in transition', 'Advanced', '#b91c1c', 16, 'A Bharatpur squad known for quick wide rotations and loud support from the bench.'],
            ['Narayangarh Nomads', 'Away days count too', 'Intermediate', '#1d4ed8', 17, 'A travelling Chitwan group that joins weekend cups whenever the fixture calendar allows.'],
            ['Bharatpur Ballers', 'Make the extra pass', 'Beginner', '#0f766e', 18, 'A mixed workplace team finding its shape one friendly at a time around Hakim Chowk.'],
            ['Patan Press', 'Press with purpose', 'Advanced', '#b45309', 19, 'A Patan side with patient build-up, committed tracking and room for one more all-rounder.'],
            ['Valley Vanguards', 'Forward together', 'Advanced', '#7c3aed', 0, 'A cross-city squad assembled for organised league football rather than casual kickabouts.'],
            ['Ring Road Rangers', 'The long way home', 'Intermediate', '#be123c', 6, 'A Ring Road group that rotates venues and always brings a spare pair of gloves.'],
            ['Kathmandu Kickers', 'Good game, every game', 'Beginner', '#0369a1', 7, 'A social team for players returning to football, with patient captains and regular Sunday slots.'],
            ['Momo FC', 'Hot play, warm welcome', 'Intermediate', '#c2410c', 8, 'A food-loving squad that plays hard, shares rides and settles every game with a team meal.'],
            ['Gorkha Guardians', 'Stand together', 'Advanced', '#15803d', 9, 'A disciplined group with strong defensive habits and a captain who tracks every team payment.'],
            ['Lakeside Linkup', 'Find the spare man', 'Intermediate', '#4338ca', 13, 'A Pokhara team built through open matches and now ready for a proper weekend tournament.'],
            ['Bagmati United', 'Different wards, one team', 'Advanced', '#a21caf', 3, 'A city-wide squad of players from different neighbourhoods who meet for Friday fixtures.'],
            ['Hetauda Highwaymen', 'Bring the energy', 'Intermediate', '#047857', 17, 'A Chitwan-based travelling side that makes the most of tournament weekends in the Valley.'],
            ['Goal Diggers Nepal', 'Every touch matters', 'Beginner', '#b91c1c', 12, 'A newer team learning the game together and actively looking for a patient goalkeeper.'],
            ['Jhamsikhel Juggernauts', 'Floodlit and focused', 'Advanced', '#0891b2', 2, 'A Jhamsikhel crew who train midweek and are happy to take on anyone who books the late slot.'],
            ['Bungamati Rovers', 'Small ground, big game', 'Intermediate', '#65a30d', 19, 'A Bungamati side that plays tight defensive football and treats every away trip as a final.'],
            ['Sankhamul Select XI', 'Pick the game up', 'Advanced', '#0d9488', 3, 'Riverside regulars who read a fast surface better than most and never stop running.'],
            ['Tinkune Terriers', 'Bite back', 'Beginner', '#ca8a04', 6, 'A friendly Koteshwor group of beginners who coach each other and finish every session with tea.'],
            ['Chitwan Cheetahs II', 'Same tail, new cubs', 'Intermediate', '#16a34a', 18, 'The Bharatpur development side feeding players into the senior Cheetahs, and unbeaten at home this season.'],
            ['Lakeside Lanterns', 'Light the evening', 'Intermediate', '#7e22ce', 13, 'A Pokhara squad that plays after sunset, works to a strict warm-up, and never books a court without a reserve.'],
        ];

        $teams = [];

        foreach ($teamRows as $index => [$name, $motto, $level, $color, $venueIndex, $description]) {
            // Stride of four keeps thirty captains distinct across 120 players,
            // where a stride of five started handing the same captain two squads.
            $captainIndex = ($index * 4) % count($players);
            $captain = $players[$captainIndex];
            $team = Team::firstOrCreate(
                ['team_code' => $this->teamCodes[$index]],
                [
                    'name' => $name,
                    'motto' => $motto,
                    'description' => $description,
                    'captain_id' => $captain->id,
                    'max_players' => 12,
                    'level' => $level,
                    'logo_color' => $color,
                    'wins' => ($index * 3) % 11,
                    'losses' => ($index * 2) % 7,
                    'draws' => $index % 4,
                    'home_ground' => $venues[$venueIndex]->name,
                    'home_venue_id' => $venues[$venueIndex]->id,
                    'looking_for_players' => $index % 4 !== 1,
                ]
            );
            $teams[] = $team;

            $rosterSize = 6 + ($index % 3);
            $memberIds = [];

            for ($rosterPosition = 0; $rosterPosition < $rosterSize; $rosterPosition++) {
                $player = $players[($captainIndex + $rosterPosition) % count($players)];
                TeamMember::firstOrCreate(
                    ['team_id' => $team->id, 'user_id' => $player->id],
                    [
                        'role' => $rosterPosition === 0 ? 'captain' : 'player',
                        'joined_at' => now()->subDays(120 - ($index * 3) - $rosterPosition),
                    ]
                );
                $memberIds[] = (int) $player->id;
            }

            $this->rosters[(int) $team->id] = $memberIds;

            foreach ($memberIds as $memberId) {
                $this->teamsByPlayer[$memberId][] = (int) $team->id;
            }
        }

        return $teams;
    }

    /** @var list<string> */
    private array $teamCodes = [
        'SAT-STRIKERS', 'KTM-CITY-11', 'LAL-LEGENDS', 'HIM-HUSTLERS',
        'CHA-CHARGERS', 'BNS-BLUESTARS', 'BKT-BHAILAS', 'THI-TOWN',
        'PHEWA-ROVERS', 'DMS-DYNAMOS', 'BRT-FALCONS', 'CHT-CHEETAH',
        'NAR-NOMADS', 'BRT-BALLERS', 'PATAN-PRESS', 'VAL-VANGUARDS',
        'RING-RANGERS', 'KTM-KICKERS', 'MOMO-FC', 'GORKHA-GUARD',
        'LAKE-LINKUP', 'BAGMATI-U', 'CHT-HIGHWAY', 'GOAL-DIGGERS',
        'JKM-JUGGER', 'BUN-ROVERS', 'SNK-SELECT', 'TNK-TERRIERS',
        'CHT-CUBS', 'LAKE-LANTERN',
    ];

    /**
     * @param  list<Team>  $teams
     * @param  list<User>  $players
     */
    private function createTeamQueues(array $teams, array $players): void
    {
        // Roster positions run 0..7 from the captain, so offsets 9 and 10 are
        // always outside the squad: the API refuses an invite or a request from
        // somebody who already plays for that team, and the seeded queue has to
        // respect the same rule.
        foreach (array_slice($teams, 0, 12) as $index => $team) {
            $captainIndex = ($index * 4) % count($players);
            $requester = $players[($captainIndex + 9) % count($players)];
            $invitee = $players[($captainIndex + 10) % count($players)];

            TeamRequest::firstOrCreate(
                ['team_id' => $team->id, 'user_id' => $requester->id, 'status' => 'pending'],
                [
                    'message' => $this->requestMessages[$index % count($this->requestMessages)],
                    'status' => 'pending',
                ]
            );
            TeamInvite::firstOrCreate(
                ['team_id' => $team->id, 'user_id' => $invitee->id, 'status' => 'pending'],
                [
                    'invited_by' => $team->captain_id,
                    'message' => $this->inviteMessages[$index % count($this->inviteMessages)],
                    'status' => 'pending',
                ]
            );
        }

        // Answered invitations, so "accepted" and "declined" both have a real
        // row behind them and the invite history screen is not empty.
        foreach (array_slice($teams, 12, 6) as $index => $team) {
            $captainIndex = (($index + 12) * 4) % count($players);
            $accepted = $players[($captainIndex + 9) % count($players)];
            $declined = $players[($captainIndex + 10) % count($players)];

            TeamInvite::firstOrCreate(
                ['team_id' => $team->id, 'user_id' => $accepted->id, 'status' => 'accepted'],
                [
                    'invited_by' => $team->captain_id,
                    'message' => 'You played well at the open game on Wednesday — fancy a run with us?',
                    'status' => 'accepted',
                    'decided_by' => $accepted->id,
                    'decided_at' => now()->subDays(9 + $index),
                ]
            );
            TeamInvite::firstOrCreate(
                ['team_id' => $team->id, 'user_id' => $declined->id, 'status' => 'declined'],
                [
                    'invited_by' => $team->captain_id,
                    'message' => 'One more midfielder wanted for the Saturday session.',
                    'status' => 'declined',
                    'decided_by' => $declined->id,
                    'decided_at' => now()->subDays(6 + $index),
                ]
            );
        }

        // Declined and withdrawn join requests — `cancelled` is the one status
        // a player sets on their own request, and it is reopenable.
        foreach (array_slice($teams, 18, 8) as $index => $team) {
            $captainIndex = (($index + 18) * 4) % count($players);
            $declined = $players[($captainIndex + 9) % count($players)];
            $cancelled = $players[($captainIndex + 10) % count($players)];

            TeamRequest::firstOrCreate(
                ['team_id' => $team->id, 'user_id' => $declined->id, 'status' => 'declined'],
                [
                    'message' => 'I can cover midfield if the Friday rotation still needs a player.',
                    'status' => 'declined',
                    'decided_at' => now()->subDays(4 + $index),
                    'decided_by' => $team->captain_id,
                ]
            );
            TeamRequest::firstOrCreate(
                ['team_id' => $team->id, 'user_id' => $cancelled->id, 'status' => 'cancelled'],
                [
                    'message' => 'Keen to join, but my shift pattern changes at the end of the month.',
                    'status' => 'cancelled',
                    'decided_at' => now()->subDays(2 + $index),
                    'decided_by' => $cancelled->id,
                ]
            );
        }
    }

    /** @var list<string> */
    private array $requestMessages = [
        'I have played regularly at this ground and can make the weekday sessions.',
        'I usually play on the wing and can bring boots, bibs and a spare ball.',
        'Your team looks like a good fit for my level. Happy to start as a substitute.',
        'I am based nearby and can commit to the league fixtures through the month.',
        'I have a goalkeeper pair but can also fill in at the back when needed.',
        'Looking for a respectful squad for regular five-a-side games after work.',
        'I saw the team at the last open match and would like to train with you.',
        'Free most Saturday afternoons and comfortable playing either side.',
        'I can share rides from the Ring Road and keep my payments on time.',
        'Please consider me for the next friendly; I am happy to earn a place.',
    ];

    /** @var list<string> */
    private array $inviteMessages = [
        'We need one more defender for the next two Friday fixtures.',
        'You played well in the open game at this ground. Want to join our rotation?',
        'Our regular keeper is away next week; we would love to have you between the posts.',
        'We are entering the Valley league and need another reliable all-rounder.',
        'Your passing stood out at training. The team would be glad to have you.',
        'We keep a friendly bench and rotate fairly. Join us for the Sunday slot?',
        'We are building a bigger squad for tournament weekends and have a place for you.',
        'The team trains close to your city preference. Let us know if the timing works.',
        'We need a forward for the upcoming cup registration and thought of you first.',
        'Come along to one session before deciding; no pressure and bibs are provided.',
    ];

    /**
     * @param  list<Team>  $teams
     * @param  list<Venue>  $venues
     * @param  list<Court>  $courts
     * @param  list<User>  $owners
     * @param  list<User>  $players
     * @return array{tournaments: list<Tournament>, entries: array<int, list<TournamentTeam>>}
     */
    private function createTournaments(array $teams, array $venues, array $courts, array $owners, array $players): array
    {
        $today = now()->startOfDay();
        $courtAtVenue = function (Venue $venue) use ($courts): ?Court {
            foreach ($courts as $candidate) {
                if ((int) $candidate->venue_id === (int) $venue->id) {
                    return $candidate;
                }
            }

            return null;
        };

        /*
         * Every entry is [teamIndex, how it paid] with an optional third status,
         * because an entry desk is not one state:
         *
         *   full       — settled in one go
         *   instalment — deposit on entry day, balance before kick-off
         *   deposit    — the deposit alone is what holds the place
         *   withdrawn  — left after paying, so League::refundFor() decides what
         *                comes back and the refund earns its own ledger row
         *
         * The five leagues are five different products on purpose: an ongoing
         * league whose group stage is done, two that have not started, a season
         * that finished with a champion paid, and an unlisted one a player runs
         * for their friends.
         */
        $rows = [
            [
                'name' => 'Bagmati 5-a-side Winter League',
                'host' => $owners[0],
                'venue' => $venues[0],
                'format' => '5v5',
                'mode' => 'group_knockout',
                'groupSize' => 4,
                'maxTeams' => 8,
                'entryFee' => 8500,
                'deposit' => 30,
                'refund' => 10,
                'prize' => 60000,
                'starts' => $today->copy()->subDays(22),
                'ends' => $today->copy()->addDays(18),
                'closes' => $today->copy()->subDays(30),
                'days' => 'Friday evenings; Saturday semi-finals',
                'visibility' => 'public',
                'status' => 'ongoing',
                'description' => 'A six-week evening league for established Kathmandu Valley squads. Group fixtures run on Fridays before the final weekend at Satdobato.',
                'rules' => 'Five players on court, rolling substitutions, three points for a win, one for a draw. Captains bring matching bibs and settle the referee fee before kick-off.',
                'prizeBreakdown' => 'Winner Rs. 40,000; runner-up Rs. 15,000; fair-play award Rs. 5,000',
                'entries' => [
                    [0, 'full'], [1, 'full'], [2, 'instalment'], [3, 'full'],
                    [4, 'deposit'], [5, 'full'], [6, 'full'], [7, 'full'],
                    [24, 'withdrawn'],
                ],
                'queue' => [
                    [13, 'requested', 'We would like to join if a late place opens for the weekend draw.'],
                    [22, 'rejected', 'Our squad is free every weekend — happy to take a place if one frees up.'],
                ],
            ],
            [
                'name' => 'Pokhara Lakeside Weekend Cup',
                'host' => $players[60],
                'venue' => $venues[13],
                'format' => '5v5',
                'mode' => 'knockout',
                'groupSize' => 4,
                'maxTeams' => 8,
                'entryFee' => 6500,
                'deposit' => 25,
                'refund' => 10,
                'prize' => 40000,
                'starts' => $today->copy()->addDays(20),
                'ends' => $today->copy()->addDays(22),
                'closes' => $today->copy()->addDays(12),
                'days' => 'Saturday morning to Sunday afternoon',
                'visibility' => 'public',
                'status' => 'registration',
                'description' => 'A relaxed but competitive weekend cup for Pokhara teams and visiting Valley sides. Group transport and a shared lunch are organised separately by captains.',
                'rules' => 'Twenty-minute matches in the group stage, rolling substitutions and knockout games decided by penalties after a drawn semi-final or final.',
                'prizeBreakdown' => 'Winner Rs. 25,000; runner-up Rs. 10,000; player of the cup Rs. 5,000',
                'entries' => [
                    [8, 'full'], [9, 'full'], [10, 'full'], [20, 'full'], [11, 'full'], [12, 'deposit'],
                ],
                'queue' => [
                    [26, 'requested', 'We are driving up for the weekend and would love a place in the draw.'],
                ],
            ],
            [
                'name' => 'Lalitpur Women\'s Friday League',
                'host' => $players[95],
                'venue' => $venues[1],
                'format' => '5v5',
                'mode' => 'round_robin',
                'groupSize' => 4,
                'maxTeams' => 6,
                'entryFee' => 5000,
                'deposit' => 25,
                'refund' => 10,
                'prize' => 30000,
                'starts' => $today->copy()->addDays(42),
                'ends' => $today->copy()->addDays(63),
                'closes' => $today->copy()->addDays(34),
                'days' => 'Friday 6 pm to 9 pm',
                'visibility' => 'public',
                'status' => 'registration',
                'description' => 'A Friday evening round robin built around safe, consistent playing time for women\'s teams in Lalitpur and nearby neighbourhoods.',
                'rules' => 'Matches are two twenty-minute halves. Captains confirm the squad list before the first fixture; abusive behaviour means removal from the league.',
                'prizeBreakdown' => 'Winner Rs. 20,000; runner-up Rs. 7,000; fair-play award Rs. 3,000',
                'entries' => [
                    [14, 'full'], [15, 'full'], [16, 'instalment'], [17, 'full'], [18, 'full'], [23, 'full'],
                ],
                'queue' => [
                    [19, 'requested', 'We would like to join if a late place opens for the Friday window.'],
                ],
            ],
            [
                'name' => 'Monsoon Cup — Season 1',
                'host' => $owners[2],
                'venue' => $venues[3],
                'format' => '5v5',
                'mode' => 'knockout',
                'groupSize' => 4,
                'maxTeams' => 8,
                'entryFee' => 7500,
                'deposit' => 30,
                'refund' => 10,
                'prize' => 50000,
                'starts' => $today->copy()->subDays(74),
                'ends' => $today->copy()->subDays(52),
                'closes' => $today->copy()->subDays(82),
                'days' => 'Sunday afternoons through to the final',
                'visibility' => 'public',
                'status' => 'completed',
                'description' => 'The season the Riverside grounds put on, now finished: a straight knockout from the first round to a packed final, with the winner paid from the pot.',
                'rules' => 'Single elimination. Draws go straight to penalties; the losing captain settles the referee fee the same evening.',
                'prizeBreakdown' => 'Champion Rs. 35,000; runner-up Rs. 10,000; top scorer Rs. 5,000',
                'entries' => [
                    [2, 'full'], [5, 'full'], [9, 'full'], [14, 'full'], [17, 'full'], [21, 'full'],
                ],
                'queue' => [],
            ],
            [
                'name' => 'Baneshwor Sunday Circle',
                'host' => $players[24],
                'venue' => $venues[4],
                'format' => '5v5',
                'mode' => 'round_robin',
                'groupSize' => 4,
                'maxTeams' => 8,
                'entryFee' => 4000,
                'deposit' => 25,
                'refund' => 15,
                'prize' => 20000,
                'starts' => $today->copy()->addDays(9),
                'ends' => $today->copy()->addDays(40),
                'closes' => $today->copy()->addDays(5),
                'days' => 'Sunday 7 am to 11 am',
                'visibility' => 'private',
                'status' => 'registration',
                'description' => 'An unlisted circle a player runs for the friends he trains with: not advertised, entries by invitation only, and the album stays with the squads in it.',
                'rules' => 'Every squad plays every other squad once. Be honest about the result — the table is only as good as the captains running it.',
                'prizeBreakdown' => 'Champion Rs. 12,000; runner-up Rs. 5,000; best goal Rs. 3,000',
                'entries' => [
                    [3, 'full'], [6, 'full'], [10, 'full'], [13, 'full'], [16, 'full'],
                    [19, 'full', 'invited'],
                ],
                'queue' => [],
            ],
        ];

        $tournaments = [];
        $entries = [];

        foreach ($rows as $index => $row) {
            $venue = $row['venue'];
            $court = $courtAtVenue($venue) ?? $courts[0];
            $host = $row['host'];
            $entryFee = (int) $row['entryFee'];
            $depositPercent = (int) $row['deposit'];
            $refundPercent = (int) $row['refund'];
            $depositDue = League::depositFor($entryFee, $depositPercent);

            $tournament = Tournament::firstOrCreate(
                ['name' => $row['name']],
                [
                    'host_id' => $host->id,
                    'host_role' => (int) $venue->owner_id === (int) $host->id ? 'owner' : 'player',
                    'venue_id' => $venue->id,
                    'court_id' => $court->id,
                    'format' => $row['format'],
                    'mode' => $row['mode'],
                    'third_place' => $row['mode'] !== 'round_robin',
                    'group_size' => (int) $row['groupSize'],
                    'max_teams' => (int) $row['maxTeams'],
                    'entry_fee' => $entryFee,
                    'deposit_percent' => $depositPercent,
                    'refund_percent' => $refundPercent,
                    'prize_pool' => (int) $row['prize'],
                    'prize_breakdown' => $row['prizeBreakdown'],
                    'starts_at' => $row['starts']->toDateString(),
                    'ends_at' => $row['ends']->toDateString(),
                    'closes_at' => $row['closes']->toDateString(),
                    'match_days' => $row['days'],
                    'visibility' => $row['visibility'],
                    'status' => $row['status'],
                    'description' => $row['description'],
                    'rules' => $row['rules'],
                    'contact_phone' => $host->phone,
                    'banner_url' => Futsal::VENUE_IMAGES[($index + 3) % count(Futsal::VENUE_IMAGES)],
                ]
            );

            $tournaments[] = $tournament;
            $entries[$tournament->id] = [];

            foreach ($row['entries'] as $position => $spec) {
                $teamIndex = (int) $spec[0];
                $story = (string) $spec[1];
                $status = (string) ($spec[2] ?? ($story === 'withdrawn' ? 'withdrawn' : 'approved'));
                $team = $teams[$teamIndex];
                $method = $position % 2 === 0 ? 'eSewa' : 'Cash at Venue';
                $paid = match ($story) {
                    'full', 'instalment' => $entryFee,
                    'deposit', 'withdrawn' => $depositDue,
                    default => 0,
                };
                $decided = in_array($status, ['approved', 'withdrawn', 'rejected'], true);

                // A host decides before the entries close, and nothing is
                // decided in the future.
                $decidedAt = $row['closes']->copy()->subDays(1 + ($position % 6));

                if ($decidedAt->gt(now())) {
                    $decidedAt = now()->subDays(2 + $position);
                }

                $entry = TournamentTeam::firstOrCreate(
                    ['tournament_id' => $tournament->id, 'team_id' => $team->id],
                    [
                        'status' => $status,
                        // An invited squad was asked by the host; every other
                        // entry was asked for by its own captain.
                        'requested_by' => $status === 'invited' ? $tournament->host_id : $team->captain_id,
                        'message' => $status === 'invited'
                            ? 'You are on the list for this one — reply when you can.'
                            : 'We can field a full squad and will settle the entry fee before the first fixture.',
                        'paid_amount' => $paid,
                        'refunded_amount' => 0,
                        'pay_method' => $paid > 0 ? $method : '',
                        'gateway_txn_id' => $paid > 0 && $method === 'eSewa' ? 'SEED-ENTRY-'.$index.'-'.$teamIndex : '',
                        'decided_by' => $decided ? $tournament->host_id : null,
                        'decided_at' => $decided ? $decidedAt : null,
                    ]
                );

                $entries[$tournament->id][] = $entry;

                $this->addEntryLedger(
                    $tournament,
                    $team,
                    $story,
                    $entryFee,
                    $depositDue,
                    $refundPercent,
                    $method,
                    $index,
                    $teamIndex
                );
            }

            foreach ($row['queue'] as $queueIndex => [$teamIndex, $status, $message]) {
                $team = $teams[$teamIndex];

                // A request the host turned down is answered after the entries
                // closed, and an answer is never dated in the future.
                $rejectedAt = $row['closes']->copy()->addDays(1 + $queueIndex);

                if ($rejectedAt->gt(now())) {
                    $rejectedAt = now()->subDays(3 + $queueIndex);
                }

                $pending = TournamentTeam::firstOrCreate(
                    ['tournament_id' => $tournament->id, 'team_id' => $team->id],
                    [
                        'status' => $status,
                        'requested_by' => $team->captain_id,
                        'message' => $message,
                        'paid_amount' => 0,
                        'refunded_amount' => 0,
                        'pay_method' => '',
                        'gateway_txn_id' => '',
                        'decided_by' => $status === 'rejected' ? $tournament->host_id : null,
                        'decided_at' => $status === 'rejected' ? $rejectedAt : null,
                    ]
                );

                $entries[$tournament->id][] = $pending;
            }
        }

        return ['tournaments' => $tournaments, 'entries' => $entries];
    }

    /**
     * The entry ledger, written the way the entry desk writes it: what was
     * paid, by whom, and — for a squad that walked away — the refund the
     * league's own percentage rule produces.
     */
    private function addEntryLedger(
        Tournament $tournament,
        Team $team,
        string $story,
        int $entryFee,
        int $depositDue,
        int $refundPercent,
        string $method,
        int $leagueIndex,
        int $teamIndex
    ): void {
        $captain = (int) $team->captain_id;
        $reference = 'SEED-ENTRY-'.$leagueIndex.'-'.$teamIndex;

        $entryPayment = function (string $kind, string $ref, int $amount, string $how) use ($tournament, $team, $captain): void {
            TournamentPayment::firstOrCreate(
                [
                    'tournament_id' => $tournament->id,
                    'team_id' => $team->id,
                    'kind' => $kind,
                    'reference' => $ref,
                ],
                [
                    'user_id' => $captain,
                    'amount' => $amount,
                    'method' => $how,
                    'recorded_by' => $tournament->host_id,
                ]
            );
        };

        if ($story === 'full') {
            $entryPayment('entry', $reference, $entryFee, $method);

            return;
        }

        if ($story === 'instalment') {
            $entryPayment('entry', $reference.'-A', $depositDue, $method);
            $entryPayment('entry', $reference.'-B', max(0, $entryFee - $depositDue), $method);

            return;
        }

        if ($story === 'deposit') {
            $entryPayment('entry', $reference, $depositDue, $method);

            return;
        }

        if ($story === 'withdrawn') {
            $entryPayment('entry', $reference, $depositDue, $method);

            $refund = League::refundFor($depositDue, $refundPercent);

            if ($refund > 0) {
                $entryPayment('refund', $reference.'-REFUND', $refund, 'Host refund');

                TournamentTeam::where('tournament_id', $tournament->id)
                    ->where('team_id', $team->id)
                    ->update(['refunded_amount' => $refund]);
            }
        }
    }

    /**
     * @param  array{owners: list<User>, players: list<User>}  $users
     * @param  list<Team>  $teams
     * @param  list<Venue>  $venues
     * @param  list<Court>  $courts
     * @param  array{tournaments: list<Tournament>, entries: array<int, list<TournamentTeam>>}  $leagues
     * @param  array<string, Promo>  $promos
     * @param  list<Voucher>  $vouchers
     * @return array{all: list<Booking>, completed: list<Booking>, public: list<Booking>, fixtureBookings: array<int, list<Booking>>}
     */
    private function createBookings(
        array $users,
        array $teams,
        array $venues,
        array $courts,
        array $leagues,
        array $promos,
        array $vouchers
    ): array {
        $players = $users['players'];
        $owners = $users['owners'];
        $today = now()->startOfDay();
        $bookings = [];
        $completed = [];
        $publicBookings = [];
        $all = $teams; // the seeded squads, keyed below for the fixture loop

        // A pitch that is out of service keeps its history but takes no new game.
        $bookableCourts = array_values(array_filter(
            $courts,
            fn (Court $court) => ! isset($this->retiredCourts[(int) $court->id])
        ));

        $venueById = [];
        $courtsByVenue = [];

        foreach ($venues as $venue) {
            $venueById[(int) $venue->id] = $venue;
        }

        foreach ($bookableCourts as $court) {
            $courtsByVenue[(int) $court->venue_id][] = $court;
        }

        $ownerForVenue = function (Venue $venue) use ($owners): User {
            $owner = User::find($venue->owner_id);

            return $owner instanceof User ? $owner : $owners[0];
        };

        /*
         * A hundred times over the same player and the same money would read as
         * filler, so the everyday ledger is walked as a set of stories instead:
         * private singles, private squad nights, public games that need bodies,
         * codes redeemed, a cancelled night with the money still to settle, and
         * the loyalty run that earns a free hour in the first place.
         */
        for ($index = 0; $index < 64; $index++) {
            // Everything the loop calls completed has already been played, so
            // the past/future split has to line up with the status below it.
            $isPast = $index < 30;
            $date = $isPast
                ? $today->copy()->subDays(($index * 3) % 90 + 2)
                : $today->copy()->addDays(($index * 2) % 40 + 1);

            $court = $bookableCourts[($index * 5) % count($bookableCourts)];
            $venue = $venueById[(int) $court->venue_id] ?? $venues[0];
            $venueOwner = $ownerForVenue($venue);
            $player = $players[($index * 7) % count($players)];

            // A squad night is only ever booked by somebody on that squad.
            $playerTeams = $this->teamsByPlayer[(int) $player->id] ?? [];
            $wantsTeam = ($index % 4 === 1) && $playerTeams !== [];
            $team = $wantsTeam ? Team::find($playerTeams[$index % count($playerTeams)]) : null;

            // The API blocks a player who has cancelled too often this month,
            // so the seeder must not hand them a booking either.
            $stats = Loyalty::playerRating(
                $this->playerHistory[(int) $player->id] ?? [],
                now(),
                (int) $player->trust_score
            );

            if ($stats['blocked']) {
                continue;
            }

            $status = $index < 30
                ? 'completed'
                : ($index < 38 ? 'confirmed' : ($index < 44 ? 'pending' : ($index < 48 ? 'cancelled' : ($index < 50 ? 'rejected' : 'confirmed'))));
            if ($isPast && $status === 'confirmed') {
                // A game a fortnight ago that is still "confirmed" is a stuck
                // booking, not a scenario anybody wants to look at.
                $status = 'completed';
            }

            $startHour = 16 + ($index % 6);
            $startTime = str_pad((string) $startHour, 2, '0', STR_PAD_LEFT).':00';
            $endTime = str_pad((string) ($startHour + 1), 2, '0', STR_PAD_LEFT).':00';

            if (! $this->claimSlot((int) $court->id, $date->toDateString(), $startTime)) {
                continue;
            }

            $hours = 1;
            $rate = $startHour < 12 ? (int) $court->price_morning : (int) $court->price_per_hour;
            $fullPrice = $rate * $hours;

            // ── a public game needs bodies, so it opens the pitch to strangers
            $isPublic = ! $isPast && ($index % 6 === 5);
            $ourCrew = $isPublic ? 4 + ($index % 3) : 1;
            $openSpots = $isPublic ? 3 + ($index % 4) : 0;
            $playersNeeded = $isPublic ? min(22, max(4, $ourCrew + $openSpots)) : 0;

            // ── a code is spent here, exactly as a player would spend it
            $promo = $this->pickPromo($promos, $venue, $fullPrice, (int) $player->id);
            $priceBeforeDiscount = $fullPrice;
            $discount = $promo
                ? (int) Promos::discountFor($promo->toArray(), $fullPrice)['amount']
                : 0;

            $totalPrice = max(0, $priceBeforeDiscount - $discount);
            $isFreeCovered = $totalPrice === 0;
            $paymentMethod = $isFreeCovered ? 'Free Play 🎁' : (($index % 3 === 0) ? 'eSewa' : (($index % 3 === 1) ? 'Khalti' : 'Cash at Venue'));
            $accepted = explode(',', (string) ($venue->accepted_payments ?? ''));

            if (! $isFreeCovered && ! in_array($paymentMethod, array_map('trim', $accepted), true)) {
                $paymentMethod = trim($accepted[0] ?? 'eSewa');
            }

            $paymentStatus = match ($status) {
                'completed' => 'paid',
                'cancelled' => ($index % 2 === 0 ? 'refunded' : 'retained'),
                'rejected' => 'none',
                default => 'pending',
            };

            if ($isFreeCovered) {
                $paymentStatus = 'paid';
            }

            // A deposit is a decision the app makes from the player's rating and
            // trust, so the seeded row uses the same rule rather than a guess.
            $depositDecision = Loyalty::depositDecision(
                [
                    'rating' => (float) $stats['rating'],
                    'total' => (int) $stats['total'],
                    'cancelsThisMonth' => (int) $stats['cancelsThisMonth'],
                ],
                (int) $player->trust_score,
                (int) ($venue->deposit_percent ?? 30)
            );
            $depositRequired = ! $isFreeCovered
                && $depositDecision['required']
                && $status === 'confirmed';

            // A squad night is settled by shares — a personal upfront deposit
            // would charge the booker twice on the same court.
            if ($team && $status === 'confirmed') {
                $depositRequired = false;
            }
            $depositAmount = $depositRequired
                ? Loyalty::depositAmountFor($totalPrice, $depositDecision['percent'])
                : 0;

            if ($depositRequired && ! in_array($paymentMethod, Loyalty::ONLINE_PAYMENTS, true)) {
                // The API refuses a cash deposit outright, so a booking that
                // needs one has to be an online payment.
                $paymentMethod = 'eSewa';
            }

            $paidAmount = match ($status) {
                'completed' => $totalPrice,
                'cancelled' => $totalPrice,
                'confirmed' => $depositAmount,
                default => 0,
            };

            if ($status === 'cancelled') {
                $paidAmount = $totalPrice;
            }

            $settled = in_array($status, ['completed', 'cancelled', 'rejected'], true);
            $gatewayTxn = $paidAmount > 0 && $paymentMethod !== 'Cash at Venue' && $paymentMethod !== 'Free Play 🎁'
                ? 'SEED-BOOKING-'.$index
                : '';

            $notes = match ($status) {
                'completed' => $team
                    ? 'Regular squad night; the crew swept the pitch before we arrived.'
                    : 'Regular weekly game; the court was swept before the session.',
                'cancelled' => 'Team availability changed before the session — the desk is settling the money now.',
                'rejected' => 'Court was already taken by a league fixture; the desk called to explain.',
                'pending' => $promo
                    ? 'Used the '.$promo->code.' code — waiting on the venue to accept.'
                    : 'Please confirm the evening slot with the venue desk.',
                default => $isPublic
                    ? 'We have a few spaces left — bring a dark and light shirt if you can.'
                    : 'Confirming the usual slot, bibs are in the bag.',
            };

            $advanceRequired = $status === 'pending' && $totalPrice > 0 && ($index % 7 === 3);

            $booking = Booking::firstOrCreate(
                [
                    'court_id' => $court->id,
                    'user_id' => $player->id,
                    'date' => $date->toDateString(),
                    'start_time' => $startTime,
                ],
                [
                    'end_time' => $endTime,
                    'duration_hours' => $hours,
                    'total_price' => $totalPrice,
                    'status' => $status,
                    'payment_status' => $paymentStatus,
                    'payment_method' => $paymentMethod,
                    'booker_name' => $player->name,
                    'booker_phone' => $player->phone,
                    'notes' => $notes,
                    'visibility' => $isPublic ? 'public' : 'private',
                    'players_needed' => $playersNeeded,
                    'our_crew' => $ourCrew,
                    'open_spots' => $openSpots,
                    'team_id' => $team?->id,
                    'team_name' => $team?->name ?? '',
                    'is_free_play' => false,
                    'voucher_id' => null,
                    'promo_id' => $promo?->id,
                    'promo_code' => $promo?->code ?? '',
                    'price_before_discount' => $priceBeforeDiscount,
                    'discount_amount' => $discount,
                    'tournament_id' => null,
                    'opponent_team_id' => null,
                    'home_score' => null,
                    'away_score' => null,
                    'score_status' => 'none',
                    'competition_status' => 'none',
                    'competition_responded_by' => null,
                    'competition_responded_at' => null,
                    'score_updated_by' => null,
                    'score_updated_at' => null,
                    'competition_payment_policy' => null,
                    'charge_mode' => 'split',
                    'custom_price_per_player' => 0,
                    'deposit_required' => $depositRequired,
                    'deposit_amount' => $depositAmount,
                    'deposit_status' => $depositRequired ? 'paid' : 'none',
                    'gateway_txn_id' => $gatewayTxn,
                    'paid_amount' => $paidAmount,
                    'settled_at' => $settled ? $date->copy()->addHours(3) : null,
                    'settled_by' => $settled ? $venueOwner->id : null,
                    'advance_payment_required' => $advanceRequired,
                    'advance_payment_amount' => $advanceRequired ? (int) ceil($totalPrice / 2) : 0,
                    'advance_payment_status' => $advanceRequired ? 'requested' : 'none',
                    'advance_payment_requested_by' => $advanceRequired ? $player->id : null,
                    'advance_payment_requested_at' => $advanceRequired ? now()->subDays(2) : null,
                    'cancellation_money_status' => $status === 'cancelled' ? 'review' : 'none',
                    'cancellation_received_amount' => $status === 'cancelled' ? $totalPrice : 0,
                    'cancellation_refunded_amount' => 0,
                    'cancellation_money_resolved_at' => null,
                    'cancellation_money_resolved_by' => null,
                ]
            );

            $bookings[] = $booking;
            $this->playerHistory[(int) $player->id][] = $booking;

            if ($status === 'completed') {
                $completed[] = $booking;
            }

            if ($isPublic) {
                $publicBookings[] = ['booking' => $booking, 'venue' => $venue, 'court' => $court];
                $this->createOpenMatchForBooking($booking, $player, $venue, $court);
            }

            // Only a private squad night splits the bill between members; a
            // public game and a league fixture are settled as one booking.
            $this->addBookingLedger(
                $booking,
                $isPublic ? null : $team,
                $venueOwner,
                $index,
                $status,
                $paidAmount,
                $totalPrice
            );

            if ($status === 'cancelled') {
                $this->cancelBookingMoney($booking, $venueOwner, $index);
            }
        }

        // ── the loyalty run: seven paid games at one ground earns a free hour
        $voucher = $vouchers[0] ?? null;
        $voucherVenue = $voucher ? ($venueById[(int) $voucher->venue_id] ?? $venues[0]) : $venues[0];
        $voucherPlayer = $voucher ? User::find($voucher->user_id) : null;
        $voucherCourts = $courtsByVenue[(int) $voucherVenue->id] ?? [$bookableCourts[0]];
        $target = Loyalty::LOYALTY_TARGET;

        if ($voucher && $voucherPlayer instanceof User) {
            for ($run = 0; $run < $target; $run++) {
                $court = $voucherCourts[$run % count($voucherCourts)];
                $date = $today->copy()->addDays(1 + intdiv($run, count($voucherCourts)));
                $startHour = 6 + ($run % 3) * 4;
                $startTime = str_pad((string) $startHour, 2, '0', STR_PAD_LEFT).':00';

                if (! $this->claimSlot((int) $court->id, $date->toDateString(), $startTime)) {
                    continue;
                }

                $rate = $startHour < 12 ? (int) $court->price_morning : (int) $court->price_per_hour;

                $runBooking = Booking::firstOrCreate(
                    [
                        'court_id' => $court->id,
                        'user_id' => $voucherPlayer->id,
                        'date' => $date->toDateString(),
                        'start_time' => $startTime,
                    ],
                    [
                        'end_time' => str_pad((string) ($startHour + 1), 2, '0', STR_PAD_LEFT).':00',
                        'duration_hours' => 1,
                        'total_price' => $rate,
                        'status' => 'confirmed',
                        'payment_status' => 'deposit_paid',
                        'payment_method' => 'eSewa',
                        'booker_name' => $voucherPlayer->name,
                        'booker_phone' => $voucherPlayer->phone,
                        'notes' => 'One of the regular slots — part of the run that earned the free hour.',
                        'visibility' => 'private',
                        'players_needed' => 0,
                        'our_crew' => 1,
                        'open_spots' => 0,
                        'team_id' => null,
                        'team_name' => '',
                        'is_free_play' => false,
                        'voucher_id' => null,
                        'promo_id' => null,
                        'promo_code' => '',
                        'price_before_discount' => $rate,
                        'discount_amount' => 0,
                        'tournament_id' => null,
                        'opponent_team_id' => null,
                        'home_score' => null,
                        'away_score' => null,
                        'score_status' => 'none',
                        'competition_status' => 'none',
                        'charge_mode' => 'single',
                        'custom_price_per_player' => 0,
                        'deposit_required' => false,
                        'deposit_amount' => 0,
                        'deposit_status' => 'none',
                        'gateway_txn_id' => 'SEED-LOYALTY-'.$run,
                        'paid_amount' => $rate,
                        'settled_at' => null,
                        'settled_by' => null,
                        'advance_payment_required' => false,
                        'advance_payment_amount' => 0,
                        'advance_payment_status' => 'none',
                        'cancellation_money_status' => 'none',
                        'cancellation_received_amount' => 0,
                        'cancellation_refunded_amount' => 0,
                    ]
                );

                $bookings[] = $runBooking;

                $this->addBookingLedger($runBooking, null, $ownerForVenue($voucherVenue), 900 + $run, 'confirmed', $rate, $rate);
            }

            // The free hour itself: the voucher flips to used, the hour is free
            // and the ledger records nothing because nothing was charged.
            $freeCourt = $voucherCourts[0];
            $freeDate = $today->copy()->addDays(3);
            $freeRate = (int) $freeCourt->price_per_hour;

            if ($this->claimSlot((int) $freeCourt->id, $freeDate->toDateString(), '18:00')) {
                $freeBooking = Booking::firstOrCreate(
                    [
                        'court_id' => $freeCourt->id,
                        'user_id' => $voucherPlayer->id,
                        'date' => $freeDate->toDateString(),
                        'start_time' => '18:00',
                    ],
                    [
                        'end_time' => '19:00',
                        'duration_hours' => 1,
                        'total_price' => max(0, $freeRate - $freeRate),
                        'status' => 'confirmed',
                        'payment_status' => 'paid',
                        'payment_method' => 'Free Play 🎁',
                        'booker_name' => $voucherPlayer->name,
                        'booker_phone' => $voucherPlayer->phone,
                        'notes' => 'Free hour from '.$target.' games this month — the desk just needs the pitch ready.',
                        'visibility' => 'private',
                        'players_needed' => 0,
                        'our_crew' => 1,
                        'open_spots' => 0,
                        'team_id' => null,
                        'team_name' => '',
                        'is_free_play' => true,
                        'voucher_id' => $voucher->id,
                        'promo_id' => null,
                        'promo_code' => '',
                        'price_before_discount' => max(0, $freeRate - $freeRate),
                        'discount_amount' => 0,
                        'tournament_id' => null,
                        'opponent_team_id' => null,
                        'home_score' => null,
                        'away_score' => null,
                        'score_status' => 'none',
                        'competition_status' => 'none',
                        'charge_mode' => 'single',
                        'custom_price_per_player' => 0,
                        'deposit_required' => false,
                        'deposit_amount' => 0,
                        'deposit_status' => 'none',
                        'gateway_txn_id' => '',
                        'paid_amount' => 0,
                        'settled_at' => null,
                        'settled_by' => null,
                        'advance_payment_required' => false,
                        'advance_payment_amount' => 0,
                        'advance_payment_status' => 'none',
                        'cancellation_money_status' => 'none',
                        'cancellation_received_amount' => 0,
                        'cancellation_refunded_amount' => 0,
                    ]
                );

                $bookings[] = $freeBooking;

                Voucher::where('id', $voucher->id)->update([
                    'status' => 'used',
                    'used_booking_id' => $freeBooking->id,
                ]);
            }
        }

        // ── league fixtures: every league gets real bookings on real courts
        $fixtureBookings = [];
        $teamById = [];

        foreach ($all as $seeded) {
            $teamById[(int) $seeded->id] = $seeded;
        }

        foreach ($leagues['tournaments'] as $leagueIndex => $tournament) {
            $approvedEntries = collect($leagues['entries'][$tournament->id] ?? [])
                ->filter(fn (TournamentTeam $entry) => $entry->status === 'approved')
                ->values();
            $fixtureBookings[$tournament->id] = [];

            if ($approvedEntries->count() < 2) {
                continue;
            }

            $leagueCourts = $courtsByVenue[(int) $tournament->venue_id] ?? [$bookableCourts[0]];
            $windowStart = now()->parse((string) $tournament->starts_at)->startOfDay();
            $windowEnd = now()->parse((string) ($tournament->ends_at ?: $tournament->starts_at))->startOfDay();
            $spanDays = max(1, (int) round(($windowEnd->getTimestamp() - $windowStart->getTimestamp()) / 86400));
            $isFinished = $tournament->status === 'completed';

            $fixtureLimit = $isFinished ? 6 : ($leagueIndex === 0 ? 4 : 3);

            for ($fixtureIndex = 0; $fixtureIndex < $fixtureLimit; $fixtureIndex++) {
                $home = $teamById[(int) $approvedEntries[$fixtureIndex % $approvedEntries->count()]->team_id] ?? $teams[0];
                $away = $teamById[(int) $approvedEntries[($fixtureIndex + 1) % $approvedEntries->count()]->team_id] ?? $teams[1];

                if (! $home || ! $away || $home->id === $away->id) {
                    continue;
                }

                $court = $leagueCourts[$fixtureIndex % count($leagueCourts)];
                $captain = User::find($home->captain_id);

                // Inside the league's own window, so a booking never lands
                // before the league opened or after it closed.
                $ratio = $fixtureLimit > 1
                    ? 0.08 + (0.8 * ($fixtureIndex / ($fixtureLimit - 1)))
                    : 0.4;
                $fixtureDate = $windowStart->copy()->addDays((int) round($ratio * $spanDays));
                $played = $isFinished || $fixtureDate->lt($today);
                $startTime = ['07:00', '08:00', '09:00', '16:00', '17:00', '19:00'][$fixtureIndex % 6];
                $rate = (int) $court->price_per_hour;
                $depositFor = (int) ceil($rate * 0.3);

                if (! $this->claimSlot((int) $court->id, $fixtureDate->toDateString(), $startTime)) {
                    continue;
                }

                $fixtureBooking = Booking::firstOrCreate(
                    [
                        'court_id' => $court->id,
                        'user_id' => $captain->id,
                        'date' => $fixtureDate->toDateString(),
                        'start_time' => $startTime,
                    ],
                    [
                        'end_time' => Futsal::addHours($startTime, 1),
                        'duration_hours' => 1,
                        'total_price' => $rate,
                        'status' => $played ? 'completed' : 'confirmed',
                        'payment_status' => $played ? 'paid' : 'deposit_paid',
                        'payment_method' => 'eSewa',
                        'booker_name' => $captain->name,
                        'booker_phone' => $captain->phone,
                        'notes' => 'League fixture booking for '.$tournament->name.'. Captains check in fifteen minutes before kick-off.',
                        'visibility' => 'competition',
                        'players_needed' => 0,
                        'our_crew' => 5,
                        'open_spots' => 0,
                        'team_id' => $home->id,
                        'team_name' => $home->name,
                        'is_free_play' => false,
                        'voucher_id' => null,
                        'promo_id' => null,
                        'promo_code' => '',
                        'price_before_discount' => $rate,
                        'discount_amount' => 0,
                        'tournament_id' => $tournament->id,
                        'opponent_team_id' => $away->id,
                        'home_score' => $played ? 2 + ($fixtureIndex % 3) : null,
                        'away_score' => $played ? 1 + (($fixtureIndex + 1) % 2) : null,
                        'score_status' => $played ? 'recorded' : 'awaiting',
                        'competition_status' => 'accepted',
                        'competition_responded_by' => $away->captain_id,
                        'competition_responded_at' => $fixtureDate->copy()->subDays(2),
                        'score_updated_by' => $played ? $tournament->host_id : null,
                        'score_updated_at' => $played ? $fixtureDate->copy()->addHours(2) : null,
                        'competition_payment_policy' => 'Each squad pays half of the court fee.',
                        'charge_mode' => 'split',
                        'custom_price_per_player' => (int) ceil($rate / 10),
                        'deposit_required' => ! $played,
                        'deposit_amount' => ! $played ? $depositFor : 0,
                        'deposit_status' => ! $played ? 'paid' : 'none',
                        'gateway_txn_id' => 'SEED-FIXTURE-'.$tournament->id.'-'.$fixtureIndex,
                        'paid_amount' => $played ? $rate : $depositFor,
                        'settled_at' => $played ? $fixtureDate->copy()->addHours(2) : null,
                        'settled_by' => $tournament->host_id,
                        'advance_payment_required' => false,
                        'advance_payment_amount' => 0,
                        'advance_payment_status' => 'none',
                        'cancellation_money_status' => 'none',
                        'cancellation_received_amount' => 0,
                        'cancellation_refunded_amount' => 0,
                    ]
                );

                $fixtureBookings[$tournament->id][] = $fixtureBooking;
                $bookings[] = $fixtureBooking;

                BookingPayment::firstOrCreate(
                    ['booking_id' => $fixtureBooking->id, 'reference' => 'SEED-FIXTURE-PAY-'.$tournament->id.'-'.$fixtureIndex],
                    [
                        'amount' => (int) $fixtureBooking->paid_amount,
                        'method' => 'eSewa',
                        'note' => 'League fixture deposit and court settlement',
                        'source' => 'owner',
                        'recorded_by' => $tournament->host_id,
                    ]
                );

                if ($played) {
                    $completed[] = $fixtureBooking;
                }
            }
        }

        return [
            'all' => $bookings,
            'completed' => $completed,
            'public' => $publicBookings,
            'fixtureBookings' => $fixtureBookings,
        ];
    }

    /**
     * A public booking is a listing as well as a row: the same pitch, the same
     * organiser, the same slots, and the booking behind it — which is what the
     * venue sees when it accepts the request.
     */
    private function createOpenMatchForBooking(Booking $booking, User $organizer, Venue $venue, Court $court): void
    {
        $maxPlayers = max(1, (int) $booking->players_needed);
        $perPlayer = (int) round((int) $booking->total_price / $maxPlayers);

        $match = OpenMatch::firstOrCreate(
            [
                'title' => '⚡ Open game at '.$venue->name,
                'date' => (string) $booking->date,
                'start_time' => (string) $booking->start_time,
            ],
            [
                'venue_id' => $venue->id,
                'court_id' => $court->id,
                'organizer_id' => $organizer->id,
                'booking_id' => $booking->id,
                'end_time' => (string) $booking->end_time,
                'price_per_player' => $perPlayer,
                'max_players' => $maxPlayers,
                'crew_size' => max(1, (int) $booking->our_crew),
                'level' => 'All Levels',
                'status' => $booking->status === 'pending' ? 'pending' : 'open',
                'description' => '👥 '.$booking->our_crew.' from our crew • 🙋 '.$booking->open_spots.' open for you! Split '
                    .'Rs. '.$perPlayer.' each! 🤝',
                'charge_mode' => 'split',
            ]
        );

        MatchJoin::firstOrCreate(
            ['match_id' => $match->id, 'user_id' => $organizer->id],
            ['status' => OpenGames::JOIN_ACCEPTED, 'position' => OpenGames::ANY_POSITION, 'joined_at' => now()->subHours(6)]
        );
    }

    /**
     * The queue a host answers, written the way the app writes it: a player asks
     * for a spot, and only the host's answer — or money offered up front —
     * makes it accepted. A pending request must never look like a taken spot.
     *
     * @param  list<Player>  $players
     */
    private function seedMatchRequests(OpenMatch $match, User $organizer, array $players, int $price, int $index): void
    {
        $needed = OpenGames::normalisePositions($match->positions_needed);
        $hostId = (int) $organizer->id;
        $open = max(0, (int) $match->max_players - (int) $match->crew_size);
        $free = MatchJoin::where('match_id', $match->id)->where('status', OpenGames::JOIN_ACCEPTED)->count();

        if ((int) $match->status !== 'open' || $free >= $open) {
            return;
        }

        $notes = [
            "I can make any day this week — I've played at {$players[0]->name}'s ground before.",
            'I was coming with two friends from college, is there still room?',
            'Happy to take the hardest spot, I do not mind playing keeper.',
            'I can pay my share right now if that helps.',
            'Just finished a game nearby, could squeeze this in.',
        ];

        // One player per kind of answer, so the host's queue on every game has
        // something in each state rather than four identical rows.
        $stories = [
            ['ask', null, ''],                 // waiting for a decision
            ['paid', 'eSewa', $price],         // paid in advance → in by default
            ['asked-payment', '', 0],          // host asked for the share
            ['declined', '', 0],               // passed over, nothing charged
        ];

        for ($slot = 0; $slot < count($stories); $slot++) {
            [$kind, $method, $amount] = $stories[$slot];

            if ($kind === 'declined' && $index % 3 !== 0) {
                continue;
            }

            $joiner = $players[(($index * 11) + ($slot * 17) + 3) % count($players)];

            if ((int) $joiner->id === $hostId) {
                continue;
            }

            $position = $needed !== [] && $slot % 2 === 0
                ? $needed[$slot % count($needed)]
                : ($needed === [] ? OpenGames::ANY_POSITION : '');

            $paid = $kind === 'paid';
            $settled = $paid;

            MatchJoin::firstOrCreate(
                ['match_id' => $match->id, 'user_id' => $joiner->id],
                [
                    'status' => match ($kind) {
                        'paid' => OpenGames::JOIN_ACCEPTED,
                        'declined' => OpenGames::JOIN_DECLINED,
                        default => OpenGames::JOIN_PENDING,
                    },
                    'position' => $position,
                    'message' => $notes[($index + $slot) % count($notes)],
                    'paid_amount' => $paid ? (int) $amount : 0,
                    'pay_method' => $paid ? (string) $method : '',
                    'payment_ref' => $paid ? 'SEED-JOIN-'.$match->id.'-'.$slot : '',
                    'paid_at' => $paid ? now()->subHours(3 + $slot) : null,
                    'payment_requested_at' => $kind === 'asked-payment' ? now()->subHours(2) : null,
                    'auto_accepted' => $paid,
                    'joined_at' => $settled ? now()->subHours(3 + $slot) : null,
                    'decided_at' => $settled || $kind === 'declined' ? now()->subHours(3 + $slot) : null,
                    'decided_by' => $settled || $kind === 'declined' ? $hostId : null,
                ]
            );
        }
    }

    /**
     * The team-payment ledger for a squad night.
     *
     * A private squad booking is a shared obligation: every member gets an
     * equal, rounded share (the app splits with intdiv and hands the remainder
     * out one rupee at a time), only the booker has a method on their row, and
     * whoever has not settled is the one the captain chases.
     */
    private function addBookingLedger(Booking $booking, ?Team $team, User $owner, int $index, string $status, int $paidAmount, int $price): void
    {
        // A squad night's venue money is driven by the shares below — one row
        // per settled online share, exactly what the gateway writes live. A
        // booking-level row on top of that would double-count the same money.
        if ($paidAmount > 0 && ! $team) {
            // Gateway money lands as one row; a cash balance is a second row the
            // desk records when the player settles at the counter.
            $isOnline = $booking->payment_method !== 'Cash at Venue' && $booking->payment_method !== 'Free Play 🎁';
            $firstAmount = $isOnline
                ? $paidAmount
                : (int) floor($paidAmount * 0.6);

            BookingPayment::firstOrCreate(
                ['booking_id' => $booking->id, 'reference' => 'SEED-BOOKING-'.$index.'-A'],
                [
                    'amount' => $firstAmount,
                    'method' => $isOnline ? $booking->payment_method : 'Cash at Venue',
                    'note' => $status === 'completed'
                        ? 'Gateway payment verified before kick-off.'
                        : 'Deposit recorded to hold the court.',
                    'source' => $isOnline ? 'gateway' : 'owner',
                    'recorded_by' => $owner->id,
                ]
            );

            if ($firstAmount < $paidAmount) {
                BookingPayment::firstOrCreate(
                    ['booking_id' => $booking->id, 'reference' => 'SEED-BOOKING-'.$index.'-B'],
                    [
                        'amount' => $paidAmount - $firstAmount,
                        'method' => 'Cash at Venue',
                        'note' => 'Balance collected at the reception desk.',
                        'source' => 'owner',
                        'recorded_by' => $owner->id,
                    ]
                );
            }
        }

        // Extras: water, bibs, a second ball — the small lines on a real bill.
        // A squad bill is the shares, nothing on top, so both stay equal.
        if (! $team && $index % 7 === 2) {
            BookingExtra::firstOrCreate(
                ['booking_id' => $booking->id, 'label' => 'Water and bib hire'],
                [
                    'amount' => 150,
                    'recorded_by' => $owner->id,
                ]
            );
        }

        if (! $team && $index % 11 === 5) {
            BookingExtra::firstOrCreate(
                ['booking_id' => $booking->id, 'label' => 'Extra match ball'],
                [
                    'amount' => 200,
                    'recorded_by' => $owner->id,
                ]
            );
        }

        if (! $team) {
            return;
        }

        // Shares for the whole squad, exactly as the app splits them.
        $members = $this->rosters[(int) $team->id] ?? [];
        $memberIds = array_values(array_unique(array_map('intval', $members)));

        if ($memberIds === []) {
            return;
        }

        if (! in_array((int) $booking->user_id, $memberIds, true)) {
            $memberIds[] = (int) $booking->user_id;
        }

        $count = count($memberIds);
        $baseShare = intdiv((int) $price, $count);
        $remainder = max(0, (int) $price - $baseShare * $count);

        // The squad's planned online method. A settled share names how the
        // money actually moved — online (it reached the venue), or cash in
        // the captain's pocket.
        $onlineMethod = in_array($booking->payment_method, ['eSewa', 'Khalti'], true)
            ? $booking->payment_method
            : null;

        // A database seeded before the squad rows got their own ledger lines
        // still holds the old booking-level rows for this game. Drop the
        // seed-owned ones so the same money is counted once; a row a player
        // actually paid carries a MOCK- reference and is never touched.
        BookingPayment::where('booking_id', $booking->id)
            ->where('reference', 'like', 'SEED-%')
            ->delete();

        $collected = 0;

        foreach ($memberIds as $position => $memberId) {
            $share = $baseShare + ($remainder-- > 0 ? 1 : 0);
            $isBooker = $memberId === (int) $booking->user_id;

            // A finished game is settled; on a confirmed one the two members
            // beside the booker have handed in theirs. The booker settles
            // their own share in the app — the row is left open on purpose so
            // the flow can actually be exercised.
            $settled = $status === 'completed'
                ? true
                : ($status === 'confirmed' && $position < 2 && ! $isBooker);

            $method = $settled && $share > 0 ? ($onlineMethod ?? 'Cash at Venue') : '';

            $intended = [
                'team_id' => $team->id,
                'amount_due' => $share,
                'payment_method' => $method,
                'payment_status' => $share === 0 || $settled ? 'paid' : 'pending',
                'paid_amount' => ($share === 0 || $settled) ? $share : 0,
                'gateway_txn_id' => $settled && $share > 0 && $onlineMethod !== null
                    ? 'SEED-TEAM-'.$booking->id.'-'.$position
                    : '',
            ];

            $row = BookingTeamPayment::firstOrCreate(
                ['booking_id' => $booking->id, 'user_id' => $memberId],
                $intended
            );

            // Databases seeded by an older version of this seeder carry
            // inconsistent share rows. Two repairs, each with a fingerprint
            // that cannot hit a row a person actually wrote:
            //
            //  - a MOCK- reference is a live gateway payment; if it was made
            //    under code that forgot to stamp the method, fix the label
            //    only — the money and the status stay as the gateway wrote
            //    them;
            //  - a row with money on it but no method is a seed row from
            //    before the seeder named how the money moved; restore the
            //    intended method and reference.
            //
            // Everything else — an unpaid row, a captain's collection, a
            // method the player chose in the app — is left exactly as is.
            $txn = (string) $row->gateway_txn_id;

            if (str_starts_with($txn, 'MOCK-')) {
                if (trim((string) $row->payment_method) === '') {
                    $row->forceFill([
                        'payment_method' => str_starts_with($txn, 'MOCK-ESEWA-') ? 'eSewa' : 'Khalti',
                    ])->save();
                }
            } elseif ((int) $row->paid_amount > 0 && trim((string) $row->payment_method) === '') {
                $row->forceFill($intended)->save();
            }

            if ($row->payment_status === 'paid' && (int) $row->paid_amount > 0) {
                $collected += (int) $row->paid_amount;

                // Online share money has already reached the venue — the same
                // fact the gateway writes live, so the desk's ledger shows it.
                if ($onlineMethod !== null) {
                    BookingPayment::firstOrCreate(
                        ['booking_id' => $booking->id, 'reference' => 'SEED-TEAM-'.$booking->id.'-'.$position],
                        [
                            'amount' => (int) $row->paid_amount,
                            'method' => $onlineMethod,
                            'note' => 'Squad share settled online.',
                            'source' => 'gateway',
                            'recorded_by' => (int) $memberId,
                        ]
                    );
                }
            }

            // Someone still owing their share gets a request naming the game.
            if ($status === 'pending' && ! $settled && $position === 3) {
                BookingPaymentRequest::firstOrCreate(
                    ['booking_id' => $booking->id, 'payer_id' => $memberId, 'status' => 'pending'],
                    [
                        'requested_by' => $team->captain_id,
                        'amount_due' => $share,
                        'purpose' => 'booking',
                        'note' => 'Please settle your share before the venue confirmation window closes.',
                        'payment_method' => '',
                        'paid_amount' => 0,
                    ]
                );
            }
        }

        // A finished game on a cash plan still ends with the venue holding
        // the money — the desk collects it after the whistle.
        if ($status === 'completed' && $onlineMethod === null && $collected > 0) {
            BookingPayment::firstOrCreate(
                ['booking_id' => $booking->id, 'reference' => 'SEED-TEAM-'.$booking->id.'-DESK'],
                [
                    'amount' => (int) $price,
                    'method' => 'Cash at Venue',
                    'note' => 'Squad shares collected at the desk after the game.',
                    'source' => 'owner',
                    'recorded_by' => $owner->id,
                ]
            );
        }

        // A cancelled squad game: the venue already had the money, and the
        // cancellation snapshot says what happened to it.
        if ($status === 'cancelled' && $price > 0) {
            BookingPayment::firstOrCreate(
                ['booking_id' => $booking->id, 'reference' => 'SEED-TEAM-'.$booking->id.'-DESK'],
                [
                    'amount' => (int) $price,
                    'method' => $onlineMethod ?? 'Cash at Venue',
                    'note' => 'Squad balance collected at the desk.',
                    'source' => $onlineMethod !== null ? 'gateway' : 'owner',
                    'recorded_by' => $owner->id,
                ]
            );
        }

        // The booking's money columns follow the squad — every settled share
        // counts, whatever pocket the money is in. The gateway uses the same
        // convention, so a re-run and a live payment agree. Cancelled and
        // rejected rows keep their creation values: the cancellation snapshot
        // owns that money story.
        if (! in_array($status, ['cancelled', 'rejected'], true)) {
            $booking->forceFill([
                'paid_amount' => min((int) $price, $collected),
                'payment_status' => $price > 0
                    ? ($collected >= (int) $price ? 'paid' : ($collected > 0 ? 'pending' : $booking->payment_status))
                    : $booking->payment_status,
            ])->save();
        }
    }

    /**
     * A cancelled game is not the end of the story: the desk either returns the
     * money or keeps it, and records which. Both answers exist in the app, so
     * the seeded set has both.
     */
    private function cancelBookingMoney(Booking $booking, User $venueOwner, int $index): void
    {
        if ($booking->status !== 'cancelled') {
            return;
        }

        $received = (int) $booking->total_price;
        $refunded = $index % 2 === 0;

        Booking::where('id', $booking->id)->update([
            'cancellation_money_status' => $refunded ? 'refunded' : 'retained',
            'cancellation_refunded_amount' => $refunded ? $received : 0,
            'cancellation_money_resolved_at' => now()->subDays(1),
            'cancellation_money_resolved_by' => $venueOwner->id,
        ]);
    }

    /**
     * Take a slot on a court, unless something already has it.
     */
    private function claimSlot(int $courtId, string $date, string $startTime): bool
    {
        $key = $courtId.'|'.$date.'|'.$startTime;

        if (isset($this->takenSlots[$key])) {
            return false;
        }

        $this->takenSlots[$key] = true;

        return true;
    }

    /**
     * Choose a code that would actually be accepted right now: switched on,
     * public, inside its window, big enough spend, and — because every seeded
     * code is limited to one per player — not already spent by this player.
     */
    private function pickPromo(array $promos, Venue $venue, int $subtotal, int $userId): ?Promo
    {
        $today = now()->toDateString();

        foreach ($promos as $promo) {
            if ((int) $promo->venue_id !== (int) $venue->id) {
                continue;
            }

            if (! $promo->is_active || ! $promo->is_public) {
                continue;
            }

            if ($promo->starts_at && $today < $promo->starts_at) {
                continue;
            }

            if ($promo->expires_at && $today > $promo->expires_at) {
                continue;
            }

            if ((int) $promo->min_booking_amount > $subtotal) {
                continue;
            }

            $use = $userId.':'.$promo->code;

            if ((int) $promo->per_user_limit > 0 && isset($this->promoUses[$use])) {
                continue;
            }

            $this->promoUses[$use] = true;

            return $promo;
        }

        return null;
    }

    /**
     * Fixtures, drawn the way the league screen draws them.
     *
     * A round robin gets every pairing once. A group stage gets every pairing
     * inside each group, and — once those are played — the bracket the groups
     * feed, seeded 1A v 2B so group mates do not meet straight away. A
     * knockout is played all the way through, byes and penalties included, and
     * the champion is paid from the pot.
     *
     * Every date is placed inside the league's own window, so nothing is
     * scheduled before the league opens or after it closes, and a game counts
     * as played only once its date has gone by.
     *
     * @param  array{tournaments: list<Tournament>, entries: array<int, list<TournamentTeam>>}  $leagues
     * @param  list<Team>  $teams
     * @param  list<Court>  $courts
     * @param  array<int, list<Booking>>  $fixtureBookings
     */
    private function createTournamentFixtures(array $leagues, array $teams, array $courts, array $fixtureBookings): void
    {
        $teamById = [];

        foreach ($teams as $team) {
            $teamById[(int) $team->id] = $team;
        }

        $today = now()->startOfDay();
        $times = ['07:00', '08:00', '16:00', '17:00', '18:00', '19:00'];

        foreach ($leagues['tournaments'] as $leagueIndex => $league) {
            $entries = collect($leagues['entries'][$league->id] ?? [])
                ->filter(fn (TournamentTeam $entry) => $entry->status === 'approved')
                ->values();

            $squadIds = $entries
                ->map(fn (TournamentTeam $entry) => (int) $entry->team_id)
                ->filter(fn (int $id) => isset($teamById[$id]))
                ->values()
                ->all();

            if (count($squadIds) < 2) {
                continue;
            }

            $leagueCourts = array_values(array_filter(
                $courts,
                fn (Court $candidate) => (int) $candidate->venue_id === (int) $league->venue_id
                    && ! isset($this->retiredCourts[(int) $candidate->id])
            ));
            $courtsForLeague = $leagueCourts === [] ? $courts : $leagueCourts;

            $windowStart = now()->parse((string) $league->starts_at)->startOfDay();
            $windowEnd = now()->parse((string) ($league->ends_at ?: $league->starts_at))->startOfDay();
            $spanDays = max(1, (int) round(($windowEnd->getTimestamp() - $windowStart->getTimestamp()) / 86400));
            $startOffset = (int) round(($windowStart->getTimestamp() - $today->getTimestamp()) / 86400);
            $isFinished = $league->status === 'completed';
            $championId = 0;

            $plan = [];

            if ($league->mode === 'round_robin') {
                $rounds = $this->roundRobinRounds($squadIds);
                $flat = [];
                $roundNumber = 0;

                foreach ($rounds as $round) {
                    $roundNumber++;

                    foreach ($round as $pair) {
                        $flat[] = ['round' => 'Round '.$roundNumber, 'home' => $pair[0], 'away' => $pair[1]];
                    }
                }

                $plan = $this->withRatios($flat, 'main', 0.05, 0.88, $startOffset, $spanDays);
            } elseif ($league->mode === 'group_knockout') {
                $groupGames = $this->groupStagePlan($league, $squadIds);
                $plan = $this->withRatios($groupGames, 'group', 0.03, 0.48, $startOffset, $spanDays);

                // The bracket only exists once the group table has settled, so
                // it is drawn from the games that are already played.
                $todayISO = $today->toDateString();
                $played = array_values(array_filter($plan, fn (array $game) => $game['date'] < $todayISO));
                $knockout = $this->knockoutPlan($league, $squadIds, $played, $isFinished, $championId);

                if ($knockout !== []) {
                    $plan = array_merge($plan, $this->withRatios($knockout, 'knockout', 0.6, 0.94, $startOffset, $spanDays));
                }
            } else {
                $knockout = $this->knockoutPlan($league, $squadIds, [], $isFinished, $championId);

                if ($knockout !== []) {
                    $plan = $this->withRatios($knockout, 'main', 0.06, 0.92, $startOffset, $spanDays);
                }
            }

            if ($plan === []) {
                continue;
            }

            $playedCount = 0;
            $bookingCursor = 0;

            foreach ($plan as $position => $game) {
                $home = $teamById[$game['home']] ?? null;
                $away = $teamById[$game['away']] ?? null;

                if (! $home || ! $away) {
                    continue;
                }

                $played = $isFinished || $game['date'] < $today->toDateString();
                $homeScore = $played ? 1 + (($position * 3) % 5) : null;
                $awayScore = $played ? 1 + (($position * 2) % 4) : null;

                if ($played && $homeScore === $awayScore && $game['stage'] === 'knockout') {
                    // A knockout game has to produce a winner.
                    $homeScore = $awayScore + 1;
                }

                $startTime = $times[($playedCount + $position) % count($times)];
                $booking = $fixtureBookings[$league->id][$bookingCursor] ?? null;
                $bookingCursor++;

                $fixture = TournamentMatch::firstOrCreate(
                    [
                        'tournament_id' => $league->id,
                        'round' => $game['round'],
                        'slot' => $game['slot'],
                    ],
                    [
                        'bracket_round' => $game['bracket'],
                        'home_from' => '',
                        'away_from' => '',
                        'home_label' => $home->name,
                        'away_label' => $away->name,
                        'home_team_id' => $home->id,
                        'away_team_id' => $away->id,
                        'date' => $game['date'],
                        'start_time' => $startTime,
                        'court_id' => $booking?->court_id ?? $courtsForLeague[$position % count($courtsForLeague)]->id,
                        'home_score' => $homeScore,
                        'away_score' => $awayScore,
                        'status' => $played ? 'played' : 'scheduled',
                        'booking_id' => $booking?->id,
                        'notes' => $played
                            ? 'Good-tempered fixture; captains confirmed the result after the final whistle.'
                            : 'Captains should arrive fifteen minutes early for bibs and the match ball.',
                        'updated_by' => $played ? $league->host_id : null,
                    ]
                );

                if ($played) {
                    $playedCount++;
                }

                // The booking holds the pitch, so the fixture follows it: same
                // date, same slot, same court.
                if ($booking && (int) $fixture->booking_id !== (int) $booking->id) {
                    $fixture->forceFill([
                        'booking_id' => $booking->id,
                        'date' => (string) $booking->date,
                        'start_time' => (string) $booking->start_time,
                        'court_id' => (int) $booking->court_id,
                    ])->save();
                }

                if ($playedCount > 0 && $playedCount <= 2) {
                    TournamentMedia::firstOrCreate(
                        [
                            'tournament_id' => $league->id,
                            'match_id' => $fixture->id,
                            'url' => Futsal::VENUE_IMAGES[($leagueIndex + $playedCount + 1) % count(Futsal::VENUE_IMAGES)],
                        ],
                        [
                            'kind' => 'link',
                            'caption' => 'Full-time team photo from the fixture',
                            'credit' => $league->venue_id === null ? 'Futsal Nepal community album' : 'Venue desk',
                            'uploaded_by' => $league->host_id,
                        ]
                    );
                }
            }

            if ($championId > 0) {
                $this->payChampion($league, $teamById, $championId);
            }
        }
    }

    /**
     * Spread a set of games across the league's own window, so a fixture never
     * lands before the league opens or after it closes.
     *
     * @param  list<array<string, mixed>>  $games
     * @return list<array<string, mixed>>
     */
    private function withRatios(array $games, string $stage, float $from, float $to, int $startOffset, int $spanDays): array
    {
        $count = count($games);
        $out = [];
        $slot = 0;

        foreach ($games as $game) {
            $ratio = $count > 1
                ? $from + (($to - $from) * ($slot / ($count - 1)))
                : $from;

            $game['stage'] = $stage;
            $game['slot'] = $slot + 1;
            $game['bracket'] = (int) ($game['bracket'] ?? 0);
            $game['date'] = now()->startOfDay()
                ->addDays($startOffset + (int) round($ratio * $spanDays))
                ->toDateString();

            $out[] = $game;
            $slot++;
        }

        return $out;
    }

    /**
     * Every pairing inside every group, labelled the way the league screen
     * labels them.
     *
     * @param  list<int>  $squadIds
     * @return list<array<string, mixed>>
     */
    private function groupStagePlan(Tournament $league, array $squadIds): array
    {
        $groups = League::makeGroups($squadIds, (int) $league->group_size);
        $games = [];

        foreach ($groups as $index => $group) {
            for ($i = 0; $i < count($group); $i++) {
                for ($j = $i + 1; $j < count($group); $j++) {
                    $games[] = [
                        'round' => League::groupLabel($index),
                        'bracket' => 0,
                        'home' => (int) $group[$i],
                        'away' => (int) $group[$j],
                    ];
                }
            }
        }

        return $games;
    }

    /**
     * A proper single round robin: every squad meets every other squad once,
     * using the same rotation the draw uses.
     *
     * @param  list<int>  $squadIds
     * @return list<list<array{0: int, 1: int}>>
     */
    private function roundRobinRounds(array $squadIds): array
    {
        $ids = array_values($squadIds);

        if (count($ids) % 2 === 1) {
            $ids[] = 0; // A bye, so an odd number of squads still rotates.
        }

        $count = count($ids);
        $rounds = [];

        for ($round = 0; $round < $count - 1; $round++) {
            $pairs = [];

            for ($i = 0; $i < intdiv($count, 2); $i++) {
                $home = $ids[$i];
                $away = $ids[$count - 1 - $i];

                if ($home === 0 || $away === 0) {
                    continue;
                }

                $pairs[] = $round % 2 === 0 ? [$home, $away] : [$away, $home];
            }

            if ($pairs !== []) {
                $rounds[] = $pairs;
            }

            // Hold the first squad still and rotate the rest around it —
            // rotating the whole list instead would repeat pairings.
            $last = array_pop($ids);
            array_splice($ids, 1, 0, [$last]);
        }

        return $rounds;
    }

    /**
     * The knockout stage, with byes resolved and a finished season played out
     * round by round so the final exists and has a winner.
     *
     * @param  list<int>  $squadIds
     * @param  list<array<string, mixed>>  $groupResults the group games already played
     * @return list<array<string, mixed>>
     */
    private function knockoutPlan(Tournament $league, array $squadIds, array $groupResults, bool $isFinished, int &$championId): array
    {
        $isGroupStage = $league->mode === 'group_knockout';

        $slots = $isGroupStage
            ? League::knockoutFromGroups($this->groupCount($league, $squadIds), ['thirdPlace' => (bool) $league->third_place])
            : League::buildBracket($squadIds, ['thirdPlace' => (bool) $league->third_place]);

        $results = [];
        $winners = [];
        $losers = [];
        $championId = 0;

        foreach ($groupResults as $game) {
            $slot = (int) ($game['slot'] ?? 0);

            $results[] = [
                'homeTeamId' => (int) $game['home'],
                'awayTeamId' => (int) $game['away'],
                'homeScore' => 1 + (($slot * 3) % 5),
                'awayScore' => 1 + (($slot * 2) % 4),
                'status' => 'played',
            ];
        }

        // A group bracket opens with "Winner Group A" slots, so the qualifiers
        // have to come off the same table the app would read.
        $qualifiers = $isGroupStage
            ? $this->groupQualifiers($league, $squadIds, $results)
            : [];

        $games = [];
        $counter = count($results);

        foreach ($slots as $slot) {
            $home = (int) $slot['homeTeamId'];
            $away = (int) $slot['awayTeamId'];
            $homeFrom = (string) $slot['homeFrom'];
            $awayFrom = (string) $slot['awayFrom'];

            if ($home === 0 && $homeFrom !== '') {
                $home = $this->resolveRef($homeFrom, $qualifiers, $winners, $losers);
            }

            if ($away === 0 && $awayFrom !== '') {
                $away = $this->resolveRef($awayFrom, $qualifiers, $winners, $losers);
            }

            if ($home === 0 && $away === 0) {
                // The round has not been reached yet: an empty bracket slot is
                // not a fixture, so nothing is written.
                continue;
            }

            if ($home === 0 || $away === 0) {
                // A side that is empty *and* has nothing feeding it is a real
                // bye — the squad walks through. A side that is empty because a
                // game has not been played yet is a different thing entirely,
                // and must wait rather than be handed a free win.
                if (($home === 0 && $homeFrom !== '') || ($away === 0 && $awayFrom !== '')) {
                    continue;
                }

                $winners[League::winnerRef((int) $slot['roundIndex'], (int) $slot['slot'])] = $home > 0 ? $home : $away;
                continue;
            }

            $games[] = [
                'round' => (string) $slot['round'],
                'bracket' => (int) $slot['roundIndex'],
                'slot' => count($games) + 1,
                'home' => $home,
                'away' => $away,
            ];

            if (! $isFinished) {
                continue;
            }

            $counter++;
            $homeScore = 1 + (($counter * 3) % 5);
            $awayScore = 1 + (($counter * 2) % 4);

            if ($homeScore === $awayScore) {
                $homeScore++; // Decided on penalties: a knockout is never a draw.
            }

            $played = [
                'homeTeamId' => $home,
                'awayTeamId' => $away,
                'homeScore' => $homeScore,
                'awayScore' => $awayScore,
                'status' => 'played',
            ];

            $results[] = $played;
            $winners[League::winnerRef((int) $slot['roundIndex'], (int) $slot['slot'])] = League::winnerOf($played);
            $losers[League::loserRef((int) $slot['roundIndex'], (int) $slot['slot'])] = League::loserOf($played);

            if ((string) $slot['round'] === 'Final') {
                $championId = (int) League::winnerOf($played);
            }
        }

        return $games;
    }

    /**
     * The top two of every group, the same order the league table sorts to.
     *
     * @param  list<int>  $squadIds
     * @param  list<array<string, mixed>>  $results
     * @return list<list<int>>
     */
    private function groupQualifiers(Tournament $league, array $squadIds, array $results): array
    {
        $qualifiers = [];

        foreach (League::makeGroups($squadIds, (int) $league->group_size) as $group) {
            $table = League::standingsFor(
                array_map(fn (int $id) => ['teamId' => $id, 'name' => (string) $id], $group),
                $results
            );

            $qualifiers[] = array_values(
                array_map(fn (array $row) => (int) $row['teamId'], array_slice($table, 0, 2))
            );
        }

        return $qualifiers;
    }

    /**
     * "G1W" is a group place, "W2-0" a bracket winner and "L2-1" a bracket
     * loser — a live bracket refers to all three.
     *
     * @param  list<list<int>>  $qualifiers
     * @param  array<string, int>  $winners
     * @param  array<string, int>  $losers
     */
    private function resolveRef(string $ref, array $qualifiers, array $winners, array $losers): int
    {
        if (preg_match('/^G(\d+)([WR])$/', $ref, $group) === 1) {
            $index = (int) $group[1] - 1;
            $place = $group[2] === 'W' ? 0 : 1;

            return (int) ($qualifiers[$index][$place] ?? 0);
        }

        if (str_starts_with($ref, 'W')) {
            return (int) ($winners[$ref] ?? 0);
        }

        if (str_starts_with($ref, 'L')) {
            return (int) ($losers[$ref] ?? 0);
        }

        return 0;
    }

    /**
     * @param  list<int>  $squadIds
     */
    private function groupCount(Tournament $league, array $squadIds): int
    {
        return max(2, count(League::makeGroups($squadIds, (int) $league->group_size)));
    }

    /**
     * A finished season pays its champion, using the champion's line of the
     * published prize breakdown rather than a round number.
     *
     * @param  array<int, Team>  $teamById
     */
    private function payChampion(Tournament $league, array $teamById, int $championId): void
    {
        $champion = $teamById[$championId] ?? null;

        if (! $champion) {
            return;
        }

        $amount = 0;
        $lines = preg_split('/\R/', (string) ($league->prize_breakdown ?? '')) ?: [];

        foreach ($lines as $line) {
            if (stripos($line, 'winner') === false && stripos($line, 'champion') === false) {
                continue;
            }

            if (preg_match('/([\d,]+)/', $line, $found) === 1) {
                $amount = (int) str_replace(',', '', $found[1]);
            }

            break;
        }

        if ($amount <= 0) {
            $amount = (int) floor(((int) $league->prize_pool) * 0.7);
        }

        if ($amount <= 0) {
            return;
        }

        TournamentPayment::firstOrCreate(
            [
                'tournament_id' => $league->id,
                'team_id' => $champion->id,
                'kind' => 'prize',
                'reference' => 'SEED-PRIZE-'.$league->id,
            ],
            [
                'user_id' => (int) $champion->captain_id,
                'amount' => $amount,
                'method' => 'Bank transfer',
                'recorded_by' => $league->host_id,
            ]
        );
    }
    /**
     * Open games, on their own, with no booking behind them.
     *
     * These are the listings a player posts to fill a court, so the set has to
     * contain the awkward ones too: a game tonight, one that is nearly full,
     * one that filled, and one the organiser pulled.
     *
     * @param  list<User>  $players
     * @param  list<Venue>  $venues
     * @param  list<Court>  $courts
     * @param  list<array{booking: Booking, venue: Venue, court: Court}>  $publicBookings
     */
    private function createOpenMatches(array $players, array $venues, array $courts, array $publicBookings): void
    {
        $today = now()->startOfDay();

        // [title, venue, court offset, player offset, level, day, hour, price, max, joiners, status, positions]
        // Most games welcome anyone (an empty list). The rest name the spots
        // they are short of, which is the whole reason the host is asked.
        $rows = [
            ['Tuesday Touches at Satdobato', 0, 1, 2, 'Intermediate', 1, 17, 250, 10, 5, 'open', []],
            ['New Baneshwor After-Work Five', 4, 0, 3, 'All Levels', 2, 18, 220, 10, 4, 'open', []],
            ['Chabahil College Night', 5, 1, 4, 'Beginner+Intermediate', 3, 19, 200, 12, 3, 'open', ['Goalkeeper', 'Defender']],
            ['Pokhara Lakeside Sunday Run', 13, 0, 5, 'Intermediate', 4, 7, 260, 10, 6, 'open', []],
            ['Bhaktapur Saturday Press', 10, 1, 6, 'Advanced', 5, 16, 240, 10, 2, 'open', ['Goalkeeper']],
            ['Damside Keepers and Runners', 14, 0, 7, 'All Levels', 2, 6, 180, 8, 4, 'open', ['Goalkeeper']],
            ['Bharatpur Midweek Kickabout', 16, 1, 8, 'Beginner', 3, 18, 190, 10, 3, 'open', []],
            ['Lalitpur Late Slot', 19, 0, 9, 'Advanced', 0, 20, 280, 10, 8, 'open', ['Midfielder', 'Forward']],
            ['Tokha Sunrise Session', 9, 0, 10, 'All Levels', 1, 6, 160, 8, 5, 'open', []],
            ['Suryabinayak Hill View Five', 10, 0, 11, 'Intermediate', 6, 17, 210, 10, 3, 'open', ['Defender']],
            ['Baluwatar Office League Warm-up', 7, 1, 12, 'Advanced', 2, 19, 270, 10, 9, 'open', ['Goalkeeper']],
            ['Dattatreya Old Boys Match', 12, 0, 13, 'All Levels', 7, 17, 200, 10, 10, 'open', []],
            ['Birauta Casual Kickabout', 15, 1, 14, 'Beginner', 4, 18, 190, 8, 2, 'open', []],
            ['Jhamsikhel Friday Five', 2, 0, 15, 'Intermediate', -3, 18, 230, 10, 7, 'completed', []],
            ['Narayangarh Morning Run', 17, 0, 16, 'All Levels', -8, 7, 170, 8, 6, 'completed', []],
            ['Maharajgunj Closed Game', 8, 1, 17, 'Advanced', -1, 19, 250, 10, 4, 'cancelled', []],
        ];

        $courtList = array_values($courts);

        foreach ($rows as $index => [$title, $venueIndex, $courtOffset, $playerOffset, $level, $dayOffset, $startHour, $price, $maxPlayers, $joinerCount, $status, $positions]) {
            $venue = $venues[$venueIndex];

            $venueCourts = array_values(array_filter(
                $courtList,
                fn (Court $candidate) => (int) $candidate->venue_id === (int) $venue->id
                    && ! isset($this->retiredCourts[(int) $candidate->id])
            ));
            $court = $venueCourts[$courtOffset % max(1, count($venueCourts))] ?? $courtList[0];

            $organizer = $players[($playerOffset * 7 + $index) % count($players)];
            $date = $today->copy()->addDays((int) $dayOffset)->toDateString();
            $start = str_pad((string) $startHour, 2, '0', STR_PAD_LEFT).':00';
            $end = str_pad((string) ($startHour + 1), 2, '0', STR_PAD_LEFT).':00';

            $match = OpenMatch::firstOrCreate(
                ['title' => $title],
                [
                    'venue_id' => $venue->id,
                    'court_id' => $court->id,
                    'organizer_id' => $organizer->id,
                    'booking_id' => null,
                    'date' => $date,
                    'start_time' => $start,
                    'end_time' => $end,
                    'price_per_player' => $price,
                    'max_players' => $maxPlayers,
                    'crew_size' => $maxPlayers - $joinerCount > 4 ? 4 : 2,
                    'level' => $level,
                    'status' => $status,
                    'description' => $status === 'cancelled'
                        ? 'Pulled for this week — the ground is closed for maintenance. Back next Wednesday.'
                        : ($status === 'completed'
                            ? 'That was a good one. Thanks to everyone who turned up.'
                            : 'Bring boots and water; we play two short games if the court is free.'),
                    'charge_mode' => 'split',
                    'positions_needed' => $positions === [] ? null : json_encode($positions),
                ]
            );

            if ($status === 'cancelled') {
                continue;
            }

            MatchJoin::firstOrCreate(
                ['match_id' => $match->id, 'user_id' => $organizer->id],
                ['status' => OpenGames::JOIN_ACCEPTED, 'position' => OpenGames::ANY_POSITION, 'joined_at' => now()->subHours(6)]
            );

            for ($joinIndex = 1; $joinIndex <= $joinerCount; $joinIndex++) {
                $joiner = $players[(($playerOffset * 7 + $index) + $joinIndex * 3) % count($players)];

                if ((int) $joiner->id === (int) $organizer->id) {
                    continue;
                }

                $slot = $positions === [] ? OpenGames::ANY_POSITION : $positions[$joinIndex % count($positions)];

                MatchJoin::firstOrCreate(
                    ['match_id' => $match->id, 'user_id' => $joiner->id],
                    [
                        'status' => OpenGames::JOIN_ACCEPTED,
                        'position' => $slot,
                        'joined_at' => now()->subHours(5 + $joinIndex),
                        'decided_at' => now()->subHours(5 + $joinIndex),
                        'decided_by' => (int) $organizer->id,
                    ]
                );
            }

            $this->seedMatchRequests($match, $organizer, $players, $price, $index);
        }

        // The listings that came from a public booking need joiners too, so
        // the open-match screen is not a wall of empty slots.
        foreach ($publicBookings as $offset => $public) {
            $match = OpenMatch::where('booking_id', $public['booking']->id)->first();

            if (! $match) {
                continue;
            }

            for ($joinIndex = 1; $joinIndex <= 3; $joinIndex++) {
                $joiner = $players[(($offset * 5) + $joinIndex * 7) % count($players)];

                if ((int) $joiner->id === (int) $public['booking']->user_id) {
                    continue;
                }

                MatchJoin::firstOrCreate(
                    ['match_id' => $match->id, 'user_id' => $joiner->id],
                    [
                        'status' => OpenGames::JOIN_ACCEPTED,
                        'position' => OpenGames::ANY_POSITION,
                        'joined_at' => now()->subHours(3 + $joinIndex),
                        'decided_at' => now()->subHours(3 + $joinIndex),
                        'decided_by' => (int) $public['booking']->user_id,
                    ]
                );
            }

            $host = User::find($public['booking']->user_id);

            if ($host) {
                $this->seedMatchRequests(
                    $match,
                    $host,
                    $players,
                    (int) $match->price_per_player,
                    $offset + 20
                );
            }
        }

        $koteshworCourt = null;
        foreach ($courtList as $candidate) {
            if ((int) $candidate->venue_id === (int) $venues[6]->id) {
                $koteshworCourt = $candidate;
                break;
            }
        }

        $historical = OpenMatch::firstOrCreate(
            ['title' => 'Old Friends at Koteshwor'],
            [
                'venue_id' => $venues[6]->id,
                'court_id' => $koteshworCourt?->id ?? $courtList[0]->id,
                'organizer_id' => $players[40]->id,
                'date' => $today->copy()->subDays(8)->toDateString(),
                'start_time' => '18:00',
                'end_time' => '19:00',
                'price_per_player' => 220,
                'max_players' => 10,
                'crew_size' => 2,
                'level' => 'All Levels',
                'status' => 'completed',
                'description' => 'A completed community game used to introduce two new players to the regular group.',
                'charge_mode' => 'split',
            ]
        );
        MatchJoin::firstOrCreate(
            ['match_id' => $historical->id, 'user_id' => $players[40]->id],
            ['status' => OpenGames::JOIN_ACCEPTED, 'position' => OpenGames::ANY_POSITION, 'joined_at' => now()->subDays(9)]
        );
        MatchJoin::firstOrCreate(
            ['match_id' => $historical->id, 'user_id' => $players[41]->id],
            ['status' => OpenGames::JOIN_ACCEPTED, 'position' => OpenGames::ANY_POSITION, 'joined_at' => now()->subDays(9)]
        );
    }

    /**
     * Every state a promo code can be in, so the owner screen and the player's
     * redemption box both have something real to show.
     *
     * @param  list<Venue>  $venues
     * @return array<string, Promo> keyed by code
     */
    private function createPromos(array $venues): array
    {
        $rows = [
            ['venue' => 0, 'code' => 'SATDO10', 'title' => 'Satdobato regulars', 'type' => 'percent', 'value' => 10, 'max' => 250, 'minimum' => 1500, 'starts' => -3, 'expires' => 45, 'public' => true, 'active' => true, 'limit' => 80],
            ['venue' => 0, 'code' => 'NEPALWEEKEND', 'title' => 'Weekend kick-off offer', 'type' => 'flat', 'value' => 300, 'max' => 300, 'minimum' => 1800, 'starts' => -10, 'expires' => 30, 'public' => true, 'active' => true, 'limit' => 45],
            ['venue' => 3, 'code' => 'RIVER15', 'title' => 'Riverside first booking', 'type' => 'percent', 'value' => 15, 'max' => 400, 'minimum' => 1600, 'starts' => -20, 'expires' => 38, 'public' => true, 'active' => true, 'limit' => 60],
            ['venue' => 4, 'code' => 'BANE2PM', 'title' => 'Early evening saving', 'type' => 'flat', 'value' => 200, 'max' => 200, 'minimum' => 1400, 'starts' => -1, 'expires' => 21, 'public' => false, 'active' => true, 'limit' => 25],
            ['venue' => 13, 'code' => 'LAKESIDE10', 'title' => 'Lakeside team discount', 'type' => 'percent', 'value' => 10, 'max' => 500, 'minimum' => 2000, 'starts' => -6, 'expires' => 52, 'public' => true, 'active' => true, 'limit' => 70],
            ['venue' => 16, 'code' => 'CHITWAN250', 'title' => 'Bharatpur community rate', 'type' => 'flat', 'value' => 250, 'max' => 250, 'minimum' => 1400, 'starts' => -15, 'expires' => 60, 'public' => true, 'active' => true, 'limit' => 50],
            ['venue' => 19, 'code' => 'PATANNEW', 'title' => 'Patan studio welcome', 'type' => 'percent', 'value' => 12, 'max' => 300, 'minimum' => 1700, 'starts' => -2, 'expires' => 28, 'public' => true, 'active' => true, 'limit' => 40],
            ['venue' => 1, 'code' => 'LALITPUR5', 'title' => 'Bhaisepati locals night', 'type' => 'percent', 'value' => 5, 'max' => 150, 'minimum' => 0, 'starts' => -30, 'expires' => 14, 'public' => true, 'active' => true, 'limit' => 35],
            ['venue' => 5, 'code' => 'CHAHABILDRAFT', 'title' => 'Draft code (not live yet)', 'type' => 'percent', 'value' => 20, 'max' => 350, 'minimum' => 1500, 'starts' => 9, 'expires' => 60, 'public' => true, 'active' => true, 'limit' => 30],
            ['venue' => 6, 'code' => 'TINKUNEOLD', 'title' => 'Last season code', 'type' => 'flat', 'value' => 250, 'max' => 250, 'minimum' => 1200, 'starts' => -120, 'expires' => -40, 'public' => true, 'active' => true, 'limit' => 20],
            ['venue' => 7, 'code' => 'BALUWARPAUSED', 'title' => 'Paused by the owner', 'type' => 'percent', 'value' => 10, 'max' => 200, 'minimum' => 0, 'starts' => -12, 'expires' => 40, 'public' => true, 'active' => false, 'limit' => 30],
        ];

        $promos = [];

        foreach ($rows as $row) {
            $promo = Promo::firstOrCreate(
                ['venue_id' => $venues[$row['venue']]->id, 'code' => $row['code']],
                [
                    'title' => $row['title'],
                    'discount_type' => $row['type'],
                    'discount_value' => $row['value'],
                    'max_discount' => $row['max'],
                    'min_booking_amount' => $row['minimum'],
                    'starts_at' => now()->addDays((int) $row['starts'])->toDateString(),
                    'expires_at' => now()->addDays((int) $row['expires'])->toDateString(),
                    'usage_limit' => $row['limit'],
                    'per_user_limit' => 1,
                    'is_public' => $row['public'],
                    'is_active' => $row['active'],
                ]
            );

            $promos[$row['code']] = $promo;
        }

        return $promos;
    }

    /**
     * Free hours are earned, not handed out: the first voucher belongs to a
     * player who then books the target number of games at that ground, which
     * is why the free-hour booking in createBookings is real rather than staged.
     *
     * @param  list<User>  $players
     * @param  list<Venue>  $venues
     * @return list<Voucher>
     */
    private function createVouchers(array $players, array $venues): array
    {
        $month = now()->format('Y-m');
        $rows = [
            [$players[0], $venues[0], 'FREE-SATDO-'.now()->format('m')],
            [$players[30], $venues[4], 'FREE-BANE-'.now()->format('m')],
            [$players[70], $venues[13], 'FREE-POKH-'.now()->format('m')],
            [$players[100], $venues[3], 'FREE-RIVER-'.now()->format('m')],
        ];

        $vouchers = [];

        foreach ($rows as [$player, $venue, $code]) {
            $vouchers[] = Voucher::firstOrCreate(
                ['user_id' => $player->id, 'venue_id' => $venue->id, 'month' => $month],
                [
                    'code' => $code,
                    'status' => 'active',
                    'used_booking_id' => null,
                ]
            );
        }

        // Last month's leftovers, so the voucher history is not empty either.
        $lastMonth = now()->subMonthNoOverflow()->format('Y-m');
        $history = [
            [$players[8], $venues[1]],
            [$players[44], $venues[10]],
        ];

        foreach ($history as [$player, $venue]) {
            Voucher::firstOrCreate(
                ['user_id' => $player->id, 'venue_id' => $venue->id, 'month' => $lastMonth],
                [
                    'code' => 'FREE-'.strtoupper(Str::substr($venue->name, 0, 4)).'-'.now()->subMonthNoOverflow()->format('m'),
                    'status' => 'used',
                    'used_booking_id' => null,
                ]
            );
        }

        return $vouchers;
    }

    /**
     * A review is written by somebody who was actually on the pitch, about the
     * ground they played on, so it is tied to a finished booking and the venue
     * that booking was on. The rating spread is deliberately uneven — an
     * average of five everywhere would make the deposit rule untestable.
     *
     * @param  list<User>  $players
     * @param  list<Venue>  $venues
     * @param  list<Court>  $courts
     * @param  list<Booking>  $completed
     */
    private function createReviews(array $players, array $venues, array $courts, array $completed): void
    {
        $messages = [
            'The turf was even and the floodlights were bright. Reception sorted our extra ball quickly.',
            'Easy booking, clean changing room and a fair court price for a full hour.',
            'The owner kept the slot ready even though our team arrived from the other side of the Ring Road.',
            'Good local ground with enough parking for scooters. We will book the same court again.',
            'The staff helped us find a substitute through the open match. Very useful for a short roster.',
            'Morning rate was reasonable and the surface had good grip after the rain.',
            'A little busy at the desk, but the pitch itself was well maintained and the game ran on time.',
            'Comfortable venue for a mixed-level group. The changing area was cleaner than expected.',
            'Our league fixture had proper bibs and a match ball waiting when we arrived.',
            'Good atmosphere, friendly caretaker and clear payment receipt after the game.',
            'The court lines were visible and there was enough space for a proper warm-up.',
            'We liked the late closing time; the team could play after everyone finished work.',
        ];

        $venueOfCourt = [];
        foreach ($courts as $court) {
            $venueOfCourt[(int) $court->id] = (int) $court->venue_id;
        }

        $seen = [];

        foreach ($completed as $index => $booking) {
            $venueId = $venueOfCourt[(int) $booking->court_id] ?? null;

            if (! $venueId) {
                continue;
            }

            // One review per player per ground, which is the rule the table
            // enforces, and always the player who did the booking.
            $pair = $venueId.':'.(int) $booking->user_id;

            if (isset($seen[$pair])) {
                continue;
            }

            $seen[$pair] = true;

            $rating = match ($index % 11) {
                0 => 3,
                1, 5 => 4,
                default => 5,
            };

            Review::firstOrCreate(
                ['venue_id' => $venueId, 'user_id' => $booking->user_id],
                [
                    'booking_id' => $booking->id,
                    'rating' => $rating,
                    'message' => $messages[$index % count($messages)],
                    'created_at' => now()->parse((string) $booking->date)->addDay(),
                ]
            );
        }

        // A ground nobody has reviewed yet still needs a first impression, so
        // the venue list is never missing a photo and a score.
        foreach (array_slice($venues, 0, 8) as $index => $venue) {
            $player = $players[70 + $index];
            Review::firstOrCreate(
                ['venue_id' => $venue->id, 'user_id' => $player->id],
                [
                    'booking_id' => null,
                    'rating' => $index % 4 === 0 ? 4 : 5,
                    'message' => 'Regular players at this ground appreciate the reliable evening slots and straightforward desk staff.',
                    'created_at' => now()->subDays(20 + $index),
                ]
            );
        }
    }

    /**
     * Every notification points at a row that exists — the booking it confirms,
     * the league it announces, the squad it invites to — so tapping one lands
     * on real content instead of an empty screen.
     *
     * @param  array{owners: list<User>, players: list<User>}  $users
     * @param  list<Team>  $teams
     * @param  array{tournaments: list<Tournament>, entries: array<int, list<TournamentTeam>>}  $leagues
     * @param  array{all: list<Booking>, completed: list<Booking>, public: list<Booking>, fixtureBookings: array<int, list<Booking>>}  $bookings
     */
    private function createNotifications(array $users, array $teams, array $leagues, array $bookings): void
    {
        $players = $users['players'];
        $owners = $users['owners'];
        $firstLeague = $leagues['tournaments'][0] ?? null;
        $nextLeague = $leagues['tournaments'][1] ?? null;
        $lastLeague = $leagues['tournaments'][4] ?? $firstLeague;
        $public = $bookings['public'][0] ?? null;
        $pending = collect($bookings['all'])->firstWhere('status', 'pending');

        // Seeded bells point at the same exact rows the live ones do, so demo
        // notifications behave like production ones instead of dumping the
        // reader on a tab and making them go and find the thing.
        $bookingIdFor = static fn ($userId): string => '/bookings?focus='
            .(string) (collect($bookings['all'])->firstWhere('user_id', $userId)?->id ?? '');
        $matchIdFor = static function (int $bookingId): string {
            $matchId = OpenMatch::where('booking_id', $bookingId)->value('id');

            return '/matches?focus='.(string) ($matchId ?? '');
        };

        $notifications = [
            [$players[0], 'booking_confirmed', 'Your Satdobato court is confirmed', 'The Himalayan Turf slot is ready. Bring the team by 7:15 pm for the 7:30 kick-off.', $bookingIdFor($players[0]->id), true],
            [$players[0], 'team_invite', 'New team invitation', 'Satdobato Strikers invited you to train with the squad this week.', '/teams', false],
            [$players[9], 'match_join', 'A player joined your open game', 'Your Tuesday Touches match has another player on the list.', '/matches', false],
            [$players[14], 'payment_request', 'Team share due', 'Your captain asked you to settle the remaining share for this week\'s booking.', $bookingIdFor($players[14]->id), false],
            [$players[24], 'league_update', 'League entry approved', 'Your team is listed in the Bagmati 5-a-side Winter League draw.', '/leagues', true],
            [$players[60], 'league_registration', 'Weekend cup registration is open', 'Pokhara Lakeside Weekend Cup is accepting team entries until the published closing date.', '/leagues', false],
            [$players[95], 'league_registration', 'Your Friday league is ready', 'The Lalitpur Women\'s Friday League has a new fixture window for captains.', '/leagues', false],
            [$owners[0], 'booking_request', 'New court request', 'A team captain has requested an evening slot at Satdobato Sports Village.', '/admin/requests', false],
            [$owners[1], 'booking_payment', 'Payment recorded', 'A team booking at Bhaisepati Sports Village has a new ledger entry.', '/admin/bookings', true],
            [$owners[5], 'league_entry', 'Tournament entry received', 'A Pokhara squad has requested a place in the Lakeside Weekend Cup.', '/leagues', false],
        ];

        // The three that have to be about *this* dataset, because the rows they
        // describe were just created.
        if ($public) {
            $publicBooking = $public['booking'];
            $notifications[] = [
                User::find($publicBooking->user_id) ?? $players[0],
                'match_join',
                'A player joined your open game',
                'Your '.Futsal::formatTime12((string) $publicBooking->start_time).' game at '.$public['venue']->name.' has another player on the list.',
                $matchIdFor((int) $publicBooking->id),
                false,
            ];
        }

        if ($pending) {
            $notifications[] = [
                User::find($pending->user_id) ?? $players[0],
                'advance_payment',
                'Advance payment requested',
                'The desk needs half of the '.(int) $pending->total_price.' before the slot is held. Settle it from My Bookings.',
                '/bookings?focus='.(string) $pending->id,
                false,
            ];
        }

        if ($firstLeague) {
            $notifications[] = [
                User::find($firstLeague->host_id) ?? $owners[0],
                'league',
                'Group stage complete 🎉',
                $firstLeague->name.': the group fixtures are in and the table has settled. The knockout draw is next.',
                '/leagues/'.$firstLeague->id,
                true,
            ];
        }

        if ($lastLeague) {
            $notifications[] = [
                User::find($lastLeague->host_id) ?? $players[24],
                'league',
                'Invitation waiting',
                $lastLeague->name.' is unlisted — squads are invited by hand and only the teams in it can see the album.',
                '/leagues/'.$lastLeague->id,
                false,
            ];
        }

        if ($nextLeague) {
            $notifications[] = [
                User::find($nextLeague->host_id) ?? $players[60],
                'league',
                'Registration closing soon',
                $nextLeague->name.' closes for entries on '.$nextLeague->closes_at.' — tell your captains before the draw is made.',
                '/leagues/'.$nextLeague->id,
                false,
            ];
        }

        foreach ($notifications as $row) {
            [$user, $type, $title, $message, $link, $read] = $row;

            if (! $user instanceof User) {
                continue;
            }

            // Keyed on user + title, not on the link: the link now carries a
            // `?focus=` id, so keying on it would re-create every row as a
            // duplicate on a re-seed. updateOrCreate refreshes the link instead.
            Notification::updateOrCreate(
                ['user_id' => $user->id, 'title' => $title],
                [
                    'type' => $type,
                    'message' => $message,
                    'link' => $link,
                    'is_read' => $read,
                ]
            );
        }

        foreach (array_slice($players, 1, 18) as $index => $player) {
            $team = $teams[$index % count($teams)];
            Notification::firstOrCreate(
                ['user_id' => $player->id, 'title' => 'Team roster update', 'link' => '/teams/'.$team->id],
                [
                    'type' => 'team',
                    'message' => $team->name.' is collecting availability for the next friendly.',
                    'is_read' => $index % 3 === 0,
                ]
            );
        }
    }

    /** @return array<string, mixed> */
    private function report(string $state): array
    {
        return [
            'ok' => true,
            'message' => $state === 'created'
                ? 'Realistic Nepal futsal dataset created.'
                : 'Realistic Nepal futsal dataset is already present; nothing was duplicated.',
            'state' => $state,
            'seedVersion' => self::VERSION,
            'demoPassword' => self::DEFAULT_PASSWORD,
            'loginExamples' => [
                'player' => 'aayush.adhikari@futsal.np',
                'owner' => 'prabin.shakya@futsal.np',
            ],
            'scenarios' => [
                'everyday' => 'Private singles and squad nights, public games that need bodies, cancellations with the money still to settle, extras on the bill, and a player part-way through the seven games that earn a free hour.',
                'payments' => 'A booking with a fair-play deposit, one with a gateway payment, one settled in cash, a payment request chasing a member\'s share, and a promo code actually spent on a bill.',
                'competition' => 'Bagmati 5-a-side Winter League with a finished group stage, a knockout bracket fed by the group table, entry fees paid in full, in instalments and on the deposit alone, plus a squad that withdrew and was refunded.',
                'seasons' => 'Monsoon Cup — Season 1 is finished: the bracket is played out, the champion is paid from the pot, and every ledger row names the captain who paid.',
                'privateLeague' => 'Baneshwor Sunday Circle is unlisted, run by a player, and its squads were invited by hand — one invite is still unanswered.',
                'openMatches' => 'Open games with and without a booking behind them: tonight\'s, one that filled, one the organiser pulled, and a completed one from last week.',
                'edgeCases' => 'Two courts retired mid-season, so their history stays but they take no new bookings; promo codes that are expired, paused, hidden or not live yet.',
            ],
            'counts' => [
                'users' => User::count(),
                'players' => User::where('role', 'player')->count(),
                'owners' => User::where('role', 'owner')->count(),
                'venues' => Venue::count(),
                'courts' => Court::count(),
                'bookings' => Booking::count(),
                'bookingPayments' => BookingPayment::count(),
                'bookingExtras' => BookingExtra::count(),
                'teamPayments' => BookingTeamPayment::count(),
                'paymentRequests' => BookingPaymentRequest::count(),
                'teams' => Team::count(),
                'teamMembers' => TeamMember::count(),
                'teamRequests' => TeamRequest::count(),
                'teamInvites' => TeamInvite::count(),
                'openMatches' => OpenMatch::count(),
                'matchJoins' => MatchJoin::count(),
                'tournaments' => Tournament::count(),
                'tournamentTeams' => TournamentTeam::count(),
                'tournamentMatches' => TournamentMatch::count(),
                'tournamentPayments' => TournamentPayment::count(),
                'tournamentMedia' => TournamentMedia::count(),
                'notifications' => Notification::count(),
                'reviews' => Review::count(),
                'promos' => Promo::count(),
                'vouchers' => Voucher::count(),
            ],
        ];
    }
}
