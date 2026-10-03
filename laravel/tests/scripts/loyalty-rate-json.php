<?php

/**
 * The same rating rules, as data.
 *
 * Reads a JSON file of scenarios — each one a booking history plus the fields
 * `Loyalty::playerRating()` derives from it — and prints the ratings back as
 * JSON. The TypeScript mirror in `src/lib/loyalty.ts` is checked against the
 * *real* PHP class through this file, so the two implementations cannot drift
 * apart without a test going red.
 *
 *     php laravel/tests/scripts/loyalty-rate-json.php /tmp/scenarios.json
 *
 * Input:
 *   {
 *     "now": "2026-10-03 12:00:00",
 *     "trust": 100,
 *     "scenarios": [
 *       { "name": "…", "rows": [ { "status": "completed", "payment_status": "paid",
 *                                  "paid_amount": 1200, "total_price": 1200,
 *                                  "settled_at": "…", "created_at": "…" } ] }
 *     ]
 *   }
 *
 * Output:
 *   { "results": [ { "name": "…", "rating": 5, "label": "…", "emoji": "…",
 *                    "paidGames": 1, "unpaidGames": 0, "completed": 1,
 *                    "cancelled": 0, "cancelsThisMonth": 0, "trustScore": 100 } ] }
 *
 * Nothing is asserted here on purpose: the caller owns the expectations, so the
 * same numbers can be compared against a second implementation rather than
 * against themselves.
 */

declare(strict_types=1);

require __DIR__.'/_loyalty_boot.php';

use App\Support\Loyalty;

$path = $argv[1] ?? '';

if ($path === '' || ! is_file($path)) {
    fwrite(STDERR, "usage: php loyalty-rate-json.php <scenarios.json>\n");
    exit(2);
}

$input = json_decode((string) file_get_contents($path), true);

if (! is_array($input) || ! isset($input['scenarios']) || ! is_array($input['scenarios'])) {
    fwrite(STDERR, "that file has no scenarios in it\n");
    exit(2);
}

$now = (string) ($input['now'] ?? '2026-10-03 12:00:00');
$trust = (int) ($input['trust'] ?? Loyalty::TRUST_START);
$results = [];

foreach ($input['scenarios'] as $scenario) {
    $stats = Loyalty::playerRating($scenario['rows'] ?? [], $now, $trust);

    $results[] = [
        'name' => (string) ($scenario['name'] ?? ''),
        'rating' => $stats['rating'],
        'label' => $stats['label'],
        'emoji' => $stats['emoji'],
        'paidGames' => $stats['paidGames'],
        'unpaidGames' => $stats['unpaidGames'],
        'completed' => $stats['completed'],
        'cancelled' => $stats['cancelled'],
        'cancelsThisMonth' => $stats['cancelsThisMonth'],
        'trustScore' => $stats['trustScore'],
    ];
}

echo json_encode(['results' => $results], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), "\n";
