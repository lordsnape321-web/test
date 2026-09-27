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
use App\Support\LegacyPassword;
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
                $bookings = $this->createBookings(
                    $users,
                    $teams,
                    $grounds['venues'],
                    $grounds['courts'],
                    $leagues
                );
                $this->createTournamentFixtures(
                    $leagues,
                    $teams,
                    $grounds['courts'],
                    $bookings['fixtureBookings']
                );
                $this->createOpenMatches($users['players'], $grounds['venues'], $grounds['courts']);
                $this->createPromos($grounds['venues']);
                $this->createVouchers($users['players'], $grounds['venues'], $bookings['completed']);
                $this->createReviews($users['players'], $grounds['venues'], $bookings['completed']);
                $this->createNotifications($users, $teams);
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
            $email = Str::slug($name).($index === 0 ? '' : '-'.$index).'@futsal.np';
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
                    'trust_score' => 86 + ($index % 15),
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
                $court = Court::firstOrCreate(
                    ['venue_id' => $venue->id, 'name' => $courtName],
                    [
                        'format' => $courtIndex === 2 ? '6v6' : '5v5',
                        'surface' => $surfaceNames[($index + $courtIndex) % count($surfaceNames)],
                        'price_per_hour' => $basePrice + ($courtIndex * 100),
                        'price_morning' => max(1000, $basePrice - 250 + ($courtIndex * 50)),
                        'image_url' => Futsal::VENUE_IMAGES[($index + $courtIndex + 2) % count(Futsal::VENUE_IMAGES)],
                        'is_active' => true,
                        'features' => $courtIndex === 0
                            ? 'Floodlights,FIFA Turf,Nets Provided,Team Bench'
                            : 'Floodlights,Artificial Turf,Nets Provided',
                    ]
                );
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
        ];

        $teams = [];

        foreach ($teamRows as $index => [$name, $motto, $level, $color, $venueIndex, $description]) {
            $captainIndex = ($index * 5) % count($players);
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

            for ($rosterPosition = 0; $rosterPosition < $rosterSize; $rosterPosition++) {
                $player = $players[($captainIndex + $rosterPosition) % count($players)];
                TeamMember::firstOrCreate(
                    ['team_id' => $team->id, 'user_id' => $player->id],
                    [
                        'role' => $rosterPosition === 0 ? 'captain' : 'player',
                        'joined_at' => now()->subDays(120 - ($index * 3) - $rosterPosition),
                    ]
                );
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
    ];

    /** @param list<Team> $teams @param list<User> $players */
    private function createTeamQueues(array $teams, array $players): void
    {
        foreach (array_slice($teams, 0, 10) as $index => $team) {
            $captainIndex = ($index * 5) % count($players);
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

        foreach (array_slice($teams, 10, 4) as $index => $team) {
            $captainIndex = (($index + 10) * 5) % count($players);
            $player = $players[($captainIndex + 9) % count($players)];
            TeamRequest::firstOrCreate(
                ['team_id' => $team->id, 'user_id' => $player->id, 'status' => 'declined'],
                [
                    'message' => 'I can cover midfield if the Friday rotation still needs a player.',
                    'status' => 'declined',
                    'decided_at' => now()->subDays(4 + $index),
                    'decided_by' => $team->captain_id,
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
            foreach ($courts as $court) {
                if ((int) $court->venue_id === (int) $venue->id) {
                    return $court;
                }
            }

            return null;
        };
        $rows = [
            [
                'name' => 'Bagmati 5-a-side Winter League',
                'host' => $owners[0],
                'venue' => $venues[0],
                'court' => $courtAtVenue($venues[0]),
                'format' => '5v5',
                'mode' => 'group_knockout',
                'maxTeams' => 8,
                'entryFee' => 8500,
                'deposit' => 30,
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
                'teams' => [0, 1, 2, 3, 4, 5, 6, 7],
                'pending' => null,
            ],
            [
                'name' => 'Pokhara Lakeside Weekend Cup',
                'host' => $players[60],
                'venue' => $venues[13],
                'court' => $courtAtVenue($venues[13]),
                'format' => '5v5',
                'mode' => 'knockout',
                'maxTeams' => 8,
                'entryFee' => 6500,
                'deposit' => 25,
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
                'teams' => [8, 9, 10, 20, 11, 12],
                'pending' => 13,
            ],
            [
                'name' => 'Lalitpur Women\'s Friday League',
                'host' => $players[95],
                'venue' => $venues[1],
                'court' => $courtAtVenue($venues[1]),
                'format' => '5v5',
                'mode' => 'round_robin',
                'maxTeams' => 6,
                'entryFee' => 5000,
                'deposit' => 25,
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
                'teams' => [14, 15, 16, 17, 18, 23],
                'pending' => 19,
            ],
        ];

        $tournaments = [];
        $entries = [];

        foreach ($rows as $index => $row) {
            $tournament = Tournament::firstOrCreate(
                ['name' => $row['name']],
                [
                    'host_id' => $row['host']->id,
                    'host_role' => $row['host']->role,
                    'venue_id' => $row['venue']->id,
                    'court_id' => $row['court']->id,
                    'format' => $row['format'],
                    'mode' => $row['mode'],
                    'third_place' => $row['mode'] !== 'round_robin',
                    'group_size' => $row['mode'] === 'group_knockout' ? 4 : 2,
                    'max_teams' => $row['maxTeams'],
                    'entry_fee' => $row['entryFee'],
                    'deposit_percent' => $row['deposit'],
                    'refund_percent' => 10,
                    'prize_pool' => $row['prize'],
                    'prize_breakdown' => $row['prizeBreakdown'],
                    'starts_at' => $row['starts']->toDateString(),
                    'ends_at' => $row['ends']->toDateString(),
                    'closes_at' => $row['closes']->toDateString(),
                    'match_days' => $row['days'],
                    'visibility' => $row['visibility'],
                    'status' => $row['status'],
                    'description' => $row['description'],
                    'rules' => $row['rules'],
                    'contact_phone' => $row['host']->phone,
                    'banner_url' => Futsal::VENUE_IMAGES[($index + 3) % count(Futsal::VENUE_IMAGES)],
                ]
            );
            $tournaments[] = $tournament;
            $entries[$tournament->id] = [];

            foreach ($row['teams'] as $teamIndex) {
                $team = $teams[$teamIndex];
                $entry = TournamentTeam::firstOrCreate(
                    ['tournament_id' => $tournament->id, 'team_id' => $team->id],
                    [
                        'status' => 'approved',
                        'requested_by' => $team->captain_id,
                        'message' => 'We can field a full squad and will settle the entry fee before the first fixture.',
                        'paid_amount' => $row['entryFee'],
                        'pay_method' => $teamIndex % 2 === 0 ? 'eSewa' : 'Cash at Venue',
                        'gateway_txn_id' => $teamIndex % 2 === 0 ? 'SEED-LEAGUE-'.$index.'-'.$teamIndex : '',
                        'decided_by' => $tournament->host_id,
                        'decided_at' => $row['starts']->copy()->subDays(7),
                    ]
                );
                $entries[$tournament->id][] = $entry;

                TournamentPayment::firstOrCreate(
                    ['tournament_id' => $tournament->id, 'team_id' => $team->id, 'kind' => 'entry', 'reference' => 'SEED-ENTRY-'.$index.'-'.$teamIndex],
                    [
                        'user_id' => $team->captain_id,
                        'amount' => $row['entryFee'],
                        'method' => $teamIndex % 2 === 0 ? 'eSewa' : 'Cash at Venue',
                        'recorded_by' => $tournament->host_id,
                    ]
                );
            }

            if ($row['pending'] !== null) {
                $pendingTeam = $teams[$row['pending']];
                $pendingEntry = TournamentTeam::firstOrCreate(
                    ['tournament_id' => $tournament->id, 'team_id' => $pendingTeam->id],
                    [
                        'status' => 'requested',
                        'requested_by' => $pendingTeam->captain_id,
                        'message' => 'We would like to join if a late place opens for the weekend draw.',
                        'paid_amount' => 0,
                        'pay_method' => '',
                        'decided_by' => null,
                        'decided_at' => null,
                    ]
                );
                $entries[$tournament->id][] = $pendingEntry;
            }
        }

        return ['tournaments' => $tournaments, 'entries' => $entries];
    }

    /**
     * @param  array{owners: list<User>, players: list<User>}  $users
     * @param  list<Team>  $teams
     * @param  list<Venue>  $venues
     * @param  list<Court>  $courts
     * @param  array{tournaments: list<Tournament>, entries: array<int, list<TournamentTeam>>}  $leagues
     * @return array{all: list<Booking>, completed: list<Booking>, fixtureBookings: array<int, list<Booking>>}
     */
    private function createBookings(array $users, array $teams, array $venues, array $courts, array $leagues): array
    {
        $players = $users['players'];
        $owners = $users['owners'];
        $today = now()->startOfDay();
        $bookings = [];
        $completed = [];

        for ($index = 0; $index < 28; $index++) {
            $isPast = $index < 12;
            $date = $isPast
                ? $today->copy()->subDays($index + 3)
                : $today->copy()->addDays($index - 9);
            $court = $courts[($index * 3) % count($courts)];
            $venue = null;
            foreach ($venues as $venueCandidate) {
                if ((int) $venueCandidate->id === (int) $court->venue_id) {
                    $venue = $venueCandidate;
                    break;
                }
            }
            $venueOwner = User::find($venue?->owner_id) ?? $owners[0];
            $player = $players[($index * 4) % count($players)];
            $team = $index % 5 === 4 ? null : $teams[$index % count($teams)];
            $status = $index < 8 ? 'completed' : ($index < 11 ? 'cancelled' : ($index < 18 ? 'confirmed' : 'pending'));
            $startHour = 16 + ($index % 5);
            $startTime = str_pad((string) $startHour, 2, '0', STR_PAD_LEFT).':00';
            $endTime = str_pad((string) ($startHour + 1), 2, '0', STR_PAD_LEFT).':00';
            $price = (int) $court->price_per_hour;
            $depositRequired = $status === 'confirmed' && $index % 3 === 0;
            $depositAmount = $depositRequired ? (int) ceil($price * 0.3) : 0;
            $cancelledPaid = $status === 'cancelled' ? $price : 0;
            $paidAmount = $status === 'completed' ? $price : ($depositRequired ? $depositAmount : $cancelledPaid);
            $paymentStatus = $status === 'completed'
                ? 'paid'
                : ($status === 'cancelled' ? ($index % 2 === 0 ? 'refunded' : 'paid') : ($depositRequired ? 'deposit_paid' : 'pending'));
            $paymentMethod = $index % 3 === 0 ? 'eSewa' : ($index % 3 === 1 ? 'Khalti' : 'Cash at Venue');
            $teamName = $team?->name ?? '';

            $booking = Booking::firstOrCreate(
                ['court_id' => $court->id, 'user_id' => $player->id, 'date' => $date->toDateString(), 'start_time' => $startTime],
                [
                    'end_time' => $endTime,
                    'duration_hours' => 1,
                    'total_price' => $price,
                    'status' => $status,
                    'payment_status' => $paymentStatus,
                    'payment_method' => $paymentMethod,
                    'booker_name' => $player->name,
                    'booker_phone' => $player->phone,
                    'notes' => $status === 'completed'
                        ? 'Regular weekly game; court was swept before the session.'
                        : ($status === 'pending' ? 'Please confirm the evening slot with the venue desk.' : 'Team availability changed before the session.'),
                    'visibility' => 'private',
                    'players_needed' => 0,
                    'our_crew' => $team ? 6 : 1,
                    'open_spots' => 0,
                    'team_id' => $team?->id,
                    'team_name' => $teamName,
                    'is_free_play' => false,
                    'price_before_discount' => $price,
                    'discount_amount' => 0,
                    'charge_mode' => $team ? 'split' : 'single',
                    'custom_price_per_player' => $team ? (int) ceil($price / 6) : 0,
                    'deposit_required' => $depositRequired,
                    'deposit_amount' => $depositAmount,
                    'deposit_status' => $depositRequired ? 'paid' : 'none',
                    'gateway_txn_id' => $paidAmount > 0 && $paymentMethod !== 'Cash at Venue' ? 'SEED-BOOKING-'.$index : '',
                    'paid_amount' => $paidAmount,
                    'settled_at' => $status === 'completed' ? $date->copy()->addHours(3) : null,
                    'settled_by' => $status === 'completed' ? $venueOwner->id : null,
                    'advance_payment_required' => false,
                    'advance_payment_amount' => 0,
                    'advance_payment_status' => 'none',
                    'cancellation_money_status' => $status === 'cancelled' ? ($index % 2 === 0 ? 'refunded' : 'retained') : 'none',
                    'cancellation_received_amount' => $cancelledPaid,
                    'cancellation_refunded_amount' => $cancelledPaid > 0 && $index % 2 === 0 ? $cancelledPaid : 0,
                    'cancellation_money_resolved_at' => $status === 'cancelled' ? $date->copy()->addDay() : null,
                    'cancellation_money_resolved_by' => $status === 'cancelled' ? $venueOwner->id : null,
                ]
            );
            $bookings[] = $booking;

            if ($status === 'completed') {
                $completed[] = $booking;
            }

            $this->addBookingLedger($booking, $team, $venueOwner, $index, $status, $paidAmount, $price);
        }

        $fixtureBookings = [];
        $teamById = [];
        foreach ($teams as $team) {
            $teamById[(int) $team->id] = $team;
        }

        foreach ($leagues['tournaments'] as $leagueIndex => $tournament) {
            $approvedEntries = collect($leagues['entries'][$tournament->id] ?? [])
                ->filter(fn (TournamentTeam $entry) => $entry->status === 'approved')
                ->values();
            $fixtureBookings[$tournament->id] = [];

            $fixtureLimit = $leagueIndex === 0
                ? min(7, max(0, $approvedEntries->count() - 1))
                : min(5, max(0, $approvedEntries->count() - 1));

            for ($fixtureIndex = 0; $fixtureIndex < $fixtureLimit; $fixtureIndex++) {
                $home = $teamById[(int) $approvedEntries[$fixtureIndex]->team_id] ?? $teams[0];
                $away = $teamById[(int) $approvedEntries[($fixtureIndex + 1) % $approvedEntries->count()]->team_id] ?? $teams[1];
                $fixtureOffset = $leagueIndex === 0
                    ? ($fixtureIndex < 3 ? -18 + ($fixtureIndex * 3) : 2 + (($fixtureIndex - 3) * 3))
                    : 25 + ($leagueIndex * 7) + $fixtureIndex;
                $fixtureDate = $today->copy()->addDays($fixtureOffset);
                $leagueCourts = array_values(array_filter(
                    $courts,
                    fn (Court $candidate) => (int) $candidate->venue_id === (int) $tournament->venue_id
                ));
                $court = $leagueCourts[$fixtureIndex % max(1, count($leagueCourts))];
                $captain = User::find($home->captain_id);
                $played = $leagueIndex === 0 && $fixtureIndex < 3;
                $homeScore = $played ? 2 + ($fixtureIndex % 3) : null;
                $awayScore = $played ? 1 + (($fixtureIndex + 1) % 2) : null;
                $fixtureBooking = Booking::firstOrCreate(
                    [
                        'court_id' => $court->id,
                        'user_id' => $captain->id,
                        'date' => $fixtureDate->toDateString(),
                        'start_time' => '19:00',
                    ],
                    [
                        'end_time' => '20:00',
                        'duration_hours' => 1,
                        'total_price' => (int) $court->price_per_hour,
                        'status' => $played ? 'completed' : 'confirmed',
                        'payment_status' => $played ? 'paid' : 'deposit_paid',
                        'payment_method' => 'eSewa',
                        'booker_name' => $captain->name,
                        'booker_phone' => $captain->phone,
                        'notes' => 'League fixture booking for '.$tournament->name.'. Captains check in fifteen minutes before kick-off.',
                        'visibility' => 'competition',
                        'players_needed' => 10,
                        'our_crew' => 5,
                        'open_spots' => 0,
                        'team_id' => $home->id,
                        'team_name' => $home->name,
                        'opponent_team_id' => $away->id,
                        'tournament_id' => $tournament->id,
                        'home_score' => $homeScore,
                        'away_score' => $awayScore,
                        'score_status' => $played ? 'recorded' : 'awaiting',
                        'competition_status' => 'accepted',
                        'competition_responded_by' => $away->captain_id,
                        'competition_responded_at' => $fixtureDate->copy()->subDays(2),
                        'score_updated_by' => $played ? $tournament->host_id : null,
                        'score_updated_at' => $played ? $fixtureDate->copy()->addHours(2) : null,
                        'competition_payment_policy' => 'Each squad pays half of the court fee.',
                        'charge_mode' => 'split',
                        'custom_price_per_player' => (int) ceil((int) $court->price_per_hour / 10),
                        'deposit_required' => ! $played,
                        'deposit_amount' => ! $played ? (int) ceil((int) $court->price_per_hour * 0.3) : 0,
                        'deposit_status' => ! $played ? 'paid' : 'none',
                        'gateway_txn_id' => 'SEED-FIXTURE-'.$tournament->id.'-'.$fixtureIndex,
                        'paid_amount' => $played ? (int) $court->price_per_hour : (int) ceil((int) $court->price_per_hour * 0.3),
                        'settled_at' => $played ? $fixtureDate->copy()->addHours(2) : null,
                        'settled_by' => $tournament->host_id,
                    ]
                );
                $fixtureBookings[$tournament->id][] = $fixtureBooking;
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
            }
        }

        return ['all' => $bookings, 'completed' => $completed, 'fixtureBookings' => $fixtureBookings];
    }

    private function addBookingLedger(Booking $booking, ?Team $team, User $owner, int $index, string $status, int $paidAmount, int $price): void
    {
        if ($paidAmount > 0) {
            $firstAmount = $status === 'completed' && $index % 2 === 0 ? (int) floor($paidAmount * 0.6) : $paidAmount;
            BookingPayment::firstOrCreate(
                ['booking_id' => $booking->id, 'reference' => 'SEED-BOOKING-'.$index.'-A'],
                [
                    'amount' => $firstAmount,
                    'method' => $booking->payment_method,
                    'note' => $status === 'completed' ? 'Gateway payment verified before kick-off.' : 'Deposit recorded to hold the court.',
                    'source' => $booking->payment_method === 'Cash at Venue' ? 'owner' : 'gateway',
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

        if ($index % 6 === 0 && $status === 'completed') {
            BookingExtra::firstOrCreate(
                ['booking_id' => $booking->id, 'label' => 'Water and bib hire'],
                [
                    'amount' => 150,
                    'recorded_by' => $owner->id,
                ]
            );
        }

        if ($team) {
            $members = TeamMember::where('team_id', $team->id)->orderBy('id')->limit(6)->get();
            $share = (int) ceil($price / max(1, $members->count()));

            foreach ($members as $position => $member) {
                $isPaid = $status === 'completed' || ($status === 'confirmed' && $position < 2);
                BookingTeamPayment::firstOrCreate(
                    ['booking_id' => $booking->id, 'user_id' => $member->user_id],
                    [
                        'team_id' => $team->id,
                        'amount_due' => $share,
                        'payment_method' => $isPaid ? ($position % 2 === 0 ? 'eSewa' : 'Cash at Venue') : '',
                        'payment_status' => $isPaid ? 'paid' : 'pending',
                        'paid_amount' => $isPaid ? $share : 0,
                        'gateway_txn_id' => $isPaid && $position % 2 === 0 ? 'SEED-TEAM-'.$booking->id.'-'.$position : '',
                    ]
                );
            }

            if ($status === 'pending') {
                $payer = $members->get(3);
                if ($payer) {
                    BookingPaymentRequest::firstOrCreate(
                        ['booking_id' => $booking->id, 'payer_id' => $payer->user_id, 'status' => 'pending'],
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
        }
    }

    /**
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

        foreach ($leagues['tournaments'] as $leagueIndex => $league) {
            // Same approved entries the bookings were built from, in draw order.
            $entries = collect($leagues['entries'][$league->id] ?? [])
                ->filter(fn (TournamentTeam $entry) => $entry->status === 'approved')
                ->values();
            $entryCount = $entries->count();

            if ($entryCount < 2) {
                continue;
            }

            for ($index = 0; $index < min(8, $entryCount - 1); $index++) {
                $home = $teamById[(int) $entries[$index]->team_id] ?? null;
                $away = $teamById[(int) $entries[($index + 1) % $entryCount]->team_id] ?? null;

                if (! $home || ! $away) {
                    continue;
                }

                $past = $leagueIndex === 0 && $index < 3;
                $booking = $fixtureBookings[$league->id][$index] ?? null;
                $date = $booking?->date ?? now()->addDays(28 + ($leagueIndex * 10) + $index)->toDateString();
                $fixture = TournamentMatch::firstOrCreate(
                    [
                        'tournament_id' => $league->id,
                        'round' => $leagueIndex === 0 ? 'Group A' : 'Quarter-final',
                        'slot' => $index + 1,
                    ],
                    [
                        'bracket_round' => $leagueIndex === 0 ? 0 : 1,
                        'home_from' => '',
                        'away_from' => '',
                        'home_label' => $home->name,
                        'away_label' => $away->name,
                        'home_team_id' => $home->id,
                        'away_team_id' => $away->id,
                        'date' => $date,
                        'start_time' => $booking?->start_time ?? '18:00',
                        'court_id' => $booking?->court_id ?? $league->court_id,
                        'home_score' => $past ? 3 + ($index % 2) : null,
                        'away_score' => $past ? 1 + ($index % 3) : null,
                        'status' => $past ? 'played' : 'scheduled',
                        'booking_id' => $booking?->id,
                        'notes' => $past
                            ? 'Good-tempered group fixture; captains confirmed the result after the final whistle.'
                            : 'Captains should arrive fifteen minutes early for bibs and the match ball.',
                        'updated_by' => $past ? $league->host_id : null,
                    ]
                );

                if ($index < 2) {
                    TournamentMedia::firstOrCreate(
                        ['tournament_id' => $league->id, 'match_id' => $fixture->id, 'url' => Futsal::VENUE_IMAGES[($leagueIndex + $index + 1) % count(Futsal::VENUE_IMAGES)]],
                        [
                            'kind' => 'link',
                            'caption' => $past ? 'Full-time team photo from the group fixture' : 'Ground and pitch information for match day',
                            'credit' => $league->venue_id === null ? 'Futsal Nepal community album' : 'Venue desk',
                            'uploaded_by' => $league->host_id,
                        ]
                    );
                }
            }
        }
    }

    /**
     * @param  list<User>  $players
     * @param  list<Venue>  $venues
     * @param  list<Court>  $courts
     */
    private function createOpenMatches(array $players, array $venues, array $courts): void
    {
        $rows = [
            ['Tuesday Touches at Satdobato', 0, 1, 2, 'Intermediate', 'Bring boots and water; we play two short games if the court is free.'],
            ['New Baneshwor After-Work Five', 4, 0, 3, 'All Levels', 'Friendly office crowd with a patient pace and a proper warm-up.'],
            ['Chabahil College Night', 5, 1, 4, 'Beginner+Intermediate', 'A mixed college group looking for four more players for a 7 pm kick-off.'],
            ['Pokhara Lakeside Sunday Run', 13, 0, 5, 'Intermediate', 'Local players and visitors welcome; we split the court evenly at the desk.'],
            ['Bhaktapur Saturday Press', 10, 1, 6, 'Advanced', 'High-energy game for players comfortable with pressing and quick changes.'],
            ['Damside Keepers and Runners', 14, 0, 7, 'All Levels', 'One keeper is confirmed; two flexible all-rounders would complete the teams.'],
            ['Bharatpur Midweek Kickabout', 16, 1, 8, 'Beginner', 'No league pressure, just a steady game for people returning to football.'],
            ['Lalitpur Late Slot', 19, 0, 9, 'Advanced', 'A fast late slot for players who can keep the ball moving under pressure.'],
        ];

        foreach ($rows as $index => [$title, $venueIndex, $courtOffset, $playerOffset, $level, $description]) {
            $venue = $venues[$venueIndex];
            $venueCourts = array_values(array_filter($courts, fn (Court $court) => (int) $court->venue_id === (int) $venue->id));
            $court = $venueCourts[$courtOffset % max(1, count($venueCourts))];
            $organizer = $players[($playerOffset * 7 + $index) % count($players)];
            $date = now()->addDays(2 + ($index * 2))->toDateString();
            $startHour = 17 + ($index % 4);
            $start = str_pad((string) $startHour, 2, '0', STR_PAD_LEFT).':00';
            $end = str_pad((string) ($startHour + 1), 2, '0', STR_PAD_LEFT).':00';
            $match = OpenMatch::firstOrCreate(
                ['title' => $title],
                [
                    'venue_id' => $venue->id,
                    'court_id' => $court->id,
                    'organizer_id' => $organizer->id,
                    'date' => $date,
                    'start_time' => $start,
                    'end_time' => $end,
                    'price_per_player' => 250 + (($index % 3) * 50),
                    'max_players' => 10,
                    'crew_size' => $index % 3 === 0 ? 2 : 1,
                    'level' => $level,
                    'status' => 'open',
                    'description' => $description,
                    'booking_id' => null,
                    'charge_mode' => 'split',
                ]
            );

            MatchJoin::firstOrCreate(
                ['match_id' => $match->id, 'user_id' => $organizer->id],
                ['status' => 'joined', 'joined_at' => now()->subHours(6)]
            );

            for ($joinIndex = 1; $joinIndex <= 2 + ($index % 4); $joinIndex++) {
                $joiner = $players[(($playerOffset * 7 + $index) + $joinIndex * 3) % count($players)];
                if ((int) $joiner->id === (int) $organizer->id) {
                    continue;
                }
                MatchJoin::firstOrCreate(
                    ['match_id' => $match->id, 'user_id' => $joiner->id],
                    ['status' => 'joined', 'joined_at' => now()->subHours(5 + $joinIndex)]
                );
            }
        }

        $koteshworCourt = null;
        foreach ($courts as $candidate) {
            if ((int) $candidate->venue_id === (int) $venues[6]->id) {
                $koteshworCourt = $candidate;
                break;
            }
        }

        $historical = OpenMatch::firstOrCreate(
            ['title' => 'Old Friends at Koteshwor'],
            [
                'venue_id' => $venues[6]->id,
                'court_id' => $koteshworCourt?->id ?? $courts[0]->id,
                'organizer_id' => $players[40]->id,
                'date' => now()->subDays(8)->toDateString(),
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
        MatchJoin::firstOrCreate(['match_id' => $historical->id, 'user_id' => $players[40]->id], ['status' => 'joined', 'joined_at' => now()->subDays(9)]);
        MatchJoin::firstOrCreate(['match_id' => $historical->id, 'user_id' => $players[41]->id], ['status' => 'joined', 'joined_at' => now()->subDays(9)]);
    }

    /** @param list<Venue> $venues */
    private function createPromos(array $venues): void
    {
        $rows = [
            [0, 'SATDO10', 'Satdobato regulars', 'percent', 10, 250, 1500, 45],
            [0, 'NEPALWEEKEND', 'Weekend kick-off offer', 'flat', 300, 300, 1800, 30],
            [3, 'RIVER15', 'Riverside first booking', 'percent', 15, 400, 1600, 38],
            [4, 'BANE2PM', 'Early evening saving', 'flat', 200, 200, 1400, 21],
            [13, 'LAKESIDE10', 'Lakeside team discount', 'percent', 10, 500, 2000, 52],
            [16, 'CHITWAN250', 'Bharatpur community rate', 'flat', 250, 250, 1400, 60],
            [19, 'PATANNEW', 'Patan studio welcome', 'percent', 12, 300, 1700, 28],
        ];

        foreach ($rows as $index => [$venueIndex, $code, $title, $type, $value, $max, $minimum, $days]) {
            Promo::firstOrCreate(
                ['venue_id' => $venues[$venueIndex]->id, 'code' => $code],
                [
                    'title' => $title,
                    'discount_type' => $type,
                    'discount_value' => $value,
                    'max_discount' => $max,
                    'min_booking_amount' => $minimum,
                    'starts_at' => now()->subDays(3)->toDateString(),
                    'expires_at' => now()->addDays($days)->toDateString(),
                    'usage_limit' => 80 + ($index * 15),
                    'per_user_limit' => 1,
                    'is_public' => $index !== 3,
                    'is_active' => true,
                ]
            );
        }
    }

    /** @param list<User> $players @param list<Venue> $venues @param list<Booking> $completed */
    private function createVouchers(array $players, array $venues, array $completed): void
    {
        $usedBooking = $completed[4] ?? null;
        Voucher::firstOrCreate(
            ['user_id' => $players[0]->id, 'venue_id' => $venues[0]->id, 'month' => now()->format('Y-m')],
            [
                'code' => 'FREE-SATDO-'.now()->format('m'),
                'status' => 'active',
                'used_booking_id' => null,
            ]
        );

        if ($usedBooking) {
            $usedVenueId = Court::find($usedBooking->court_id)?->venue_id ?? $venues[4]->id;
            Voucher::firstOrCreate(
                ['user_id' => $usedBooking->user_id, 'venue_id' => $usedVenueId, 'month' => now()->format('Y-m')],
                [
                    'code' => 'USED-BANE-'.now()->format('m'),
                    'status' => 'used',
                    'used_booking_id' => $usedBooking->id,
                ]
            );
        }

        Voucher::firstOrCreate(
            ['user_id' => $players[21]->id, 'venue_id' => $venues[13]->id, 'month' => now()->format('Y-m')],
            [
                'code' => 'FREE-POKH-'.now()->format('m'),
                'status' => 'active',
                'used_booking_id' => null,
            ]
        );
    }

    /** @param list<User> $players @param list<Venue> $venues @param list<Booking> $completed */
    private function createReviews(array $players, array $venues, array $completed): void
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

        foreach ($completed as $index => $booking) {
            $venueId = Court::find($booking->court_id)?->venue_id;
            if (! $venueId) {
                continue;
            }

            $player = $players[($index * 9) % count($players)];
            Review::firstOrCreate(
                ['venue_id' => $venueId, 'user_id' => $player->id],
                [
                    'booking_id' => $booking->id,
                    'rating' => $index % 7 === 0 ? 4 : 5,
                    'message' => $messages[$index % count($messages)],
                    'created_at' => now()->subDays(2 + $index),
                ]
            );
        }

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

    /** @param array{owners: list<User>, players: list<User>} $users @param list<Team> $teams */
    private function createNotifications(array $users, array $teams): void
    {
        $players = $users['players'];
        $owners = $users['owners'];
        $notifications = [
            [$players[0], 'booking_confirmed', 'Your Satdobato court is confirmed', 'The Himalayan Turf slot is ready. Bring the team by 7:15 pm for the 7:30 kick-off.', '/bookings', true],
            [$players[0], 'team_invite', 'New team invitation', 'Satdobato Strikers invited you to train with the squad this week.', '/teams', false],
            [$players[9], 'match_join', 'A player joined your open game', 'Your Tuesday Touches match has another player on the list.', '/matches', false],
            [$players[14], 'payment_request', 'Team share due', 'Your captain asked you to settle the remaining share for this week\'s booking.', '/bookings', false],
            [$players[24], 'league_update', 'League entry approved', 'Your team is listed in the Bagmati 5-a-side Winter League draw.', '/leagues', true],
            [$players[60], 'league_registration', 'Weekend cup registration is open', 'Pokhara Lakeside Weekend Cup is accepting team entries until the published closing date.', '/leagues', false],
            [$players[95], 'league_registration', 'Your Friday league is ready', 'The Lalitpur Women\'s Friday League has a new fixture window for captains.', '/leagues', false],
            [$owners[0], 'booking_request', 'New court request', 'A team captain has requested an evening slot at Satdobato Sports Village.', '/admin/requests', false],
            [$owners[1], 'booking_payment', 'Payment recorded', 'A team booking at Bhaisepati Sports Village has a new ledger entry.', '/admin/bookings', true],
            [$owners[5], 'league_entry', 'Tournament entry received', 'A Pokhara squad has requested a place in the Lakeside Weekend Cup.', '/leagues', false],
        ];

        foreach ($notifications as [$user, $type, $title, $message, $link, $read]) {
            Notification::firstOrCreate(
                ['user_id' => $user->id, 'title' => $title, 'link' => $link],
                [
                    'type' => $type,
                    'message' => $message,
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
                'everyday' => 'A completed Satdobato booking, a future team booking with a deposit and a live open game with joined players.',
                'competition' => 'Bagmati 5-a-side Winter League fixtures with approved teams, entry payments, scores, media and upcoming matches.',
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
