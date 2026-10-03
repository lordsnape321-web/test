<?php

/**
 * The reliability rating, exercised against the real `App\Support\Loyalty`.
 *
 * Run without composer, without a database, without a framework:
 *
 *     php laravel/tests/scripts/loyalty-rating.php
 *
 * `Loyalty` is pure arithmetic — that is the point of the class — so the only
 * thing standing between it and a bare PHP process is the `now()` helper from
 * the framework, which `_loyalty_boot.php` stubs with just the date methods the
 * class actually calls. The machine-checked mirror of these rules lives in
 * `futsal-expo-app/scripts/rating.test.mjs`; this file is the readable one.
 *
 * What this is guarding: the round-7 report that "rating doesn't move on
 * payment". The cases below nail the rule down so it cannot silently regress
 * again — a game that was played and paid is worth a full credit, a game played
 * with the bill still open is worth half of one, and settling the bill later
 * heals the number, because the rating is recomputed from booking history on
 * every read and never stored.
 */

declare(strict_types=1);

require __DIR__.'/_loyalty_boot.php';

use App\Support\Loyalty;

/* ── a two-line test harness ──────────────────────────────────────────────── */

$checks = 0;
$failures = [];

function check(string $what, mixed $expected, mixed $actual): void
{
    global $checks, $failures;
    $checks++;

    if ($expected !== $actual) {
        $failures[] = sprintf(
            "%s\n    expected: %s\n    actual:   %s",
            $what,
            var_export($expected, true),
            var_export($actual, true)
        );
    }
}

/** A played game: the shape `Loyalty::HISTORY_COLUMNS` selects. */
function played(array $overrides = []): array
{
    return array_merge([
        'status' => 'completed',
        'created_at' => '2026-09-20 18:00:00',
        'payment_status' => 'paid',
        'paid_amount' => 1200,
        'settled_at' => '2026-09-20 18:00:00',
        'total_price' => 1200,
    ], $overrides);
}

function cancelled(array $overrides = []): array
{
    return array_merge([
        'status' => 'cancelled',
        'created_at' => '2026-09-25 18:00:00',
        'payment_status' => 'pending',
        'paid_amount' => 0,
        'settled_at' => null,
        'total_price' => 1200,
    ], $overrides);
}

/** Played, but the venue is still waiting for its money. */
function owes(array $overrides = []): array
{
    return played(array_merge([
        'payment_status' => 'pending',
        'paid_amount' => 0,
        'settled_at' => null,
    ], $overrides));
}

$now = '2026-10-03 12:00:00';
$rate = fn (array $rows) => Loyalty::playerRating($rows, $now, 100);

/* ── the rating itself ────────────────────────────────────────────────────── */

$empty = $rate([]);
check('no bookings → new player', 'New player', $empty['label']);
check('no bookings → 5.0', 5.0, $empty['rating']);

$perfect = $rate([played(), played(), played(), played()]);
check('four played-and-paid → 5.0', 5.0, $perfect['rating']);
check('four played-and-paid → paid count', 4, $perfect['paidGames']);
check('four played-and-paid → nothing owing', 0, $perfect['unpaidGames']);
check('four played-and-paid → super reliable', 'Super reliable', $perfect['label']);

// 3 credits of 4 decisive games = 3.75 → 3.8
$oneCancel = $rate([played(), played(), played(), cancelled()]);
check('three played, one cancelled → 3.8', 3.8, $oneCancel['rating']);
check('cancelled game is not a paid game', 3, $oneCancel['paidGames']);
check('cancelled game is not an unpaid game', 0, $oneCancel['unpaidGames']);

// A played-but-unpaid game is half a credit: (3 + 0.5) / 4 = 4.375 → 4.4
$half = $rate([played(), played(), played(), owes()]);
check('three paid + one owing → 4.4', 4.4, $half['rating']);
check('owing game counted', 1, $half['unpaidGames']);

// One game, played, not paid: 0.5 / 1 = 2.5 — and the label says why.
$onlyOwed = $rate([owes()]);
check('single unpaid game → 2.5', 2.5, $onlyOwed['rating']);
check('unpaid label names the problem', 'Owes on a played game', $onlyOwed['label']);
check('unpaid label emoji', '💸', $onlyOwed['emoji']);

// The same history after the bill is settled: the number heals with no other
// change, which is the whole point of deriving it instead of storing it.
$sameGamePaid = $rate([played()]);
check('same game, now settled → 5.0', 5.0, $sameGamePaid['rating']);
check('settled game no longer flagged', 0, $sameGamePaid['unpaidGames']);

// Cancels only: 5 − 2×0.8 = 3.4
$twoCancels = $rate([cancelled(), cancelled()]);
check('two cancels, nothing played → 3.4', 3.4, $twoCancels['rating']);

// 1 credit of 2 decisive = 2.5
$mixed = $rate([played(), cancelled()]);
check('one played, one cancelled → 2.5', 2.5, $mixed['rating']);
check('one played, one cancelled → needs care', 'Needs care', $mixed['label']);

/* ── how "settled" is decided ─────────────────────────────────────────────── */

check('payment_status paid counts', true, Loyalty::bookingSettled(played()));
check('settled_at alone counts', true, Loyalty::bookingSettled([
    'payment_status' => 'pending', 'paid_amount' => 0, 'total_price' => 1200, 'settled_at' => '2026-09-21 10:00:00',
]));
check('paid_amount covering the price counts', true, Loyalty::bookingSettled([
    'payment_status' => 'pending', 'paid_amount' => 1200, 'total_price' => 1200, 'settled_at' => null,
]));
check('part payment does not count', false, Loyalty::bookingSettled([
    'payment_status' => 'pending', 'paid_amount' => 700, 'total_price' => 1200, 'settled_at' => null,
]));
check('a free game owes nothing', true, Loyalty::bookingSettled([
    'payment_status' => 'pending', 'paid_amount' => 0, 'total_price' => 0, 'settled_at' => null,
]));

// Rows selected before round 7 carried no payment columns at all. They must not
// be read as "owes money" — the old callers keep working.
$legacy = $rate([
    ['status' => 'completed', 'created_at' => '2026-09-20 18:00:00'],
    ['status' => 'completed', 'created_at' => '2026-09-21 18:00:00'],
]);
check('rows without payment columns are not punished', 5.0, $legacy['rating']);
check('rows without payment columns → no owing count', 0, $legacy['unpaidGames']);

// An explicit `paid` flag from a caller that did its own maths wins.
check('an explicit paid flag beats the raw columns', 0, $rate([played(['paid' => false])])['paidGames']);

/* ── trust: the other half of "payment and played status" ─────────────────── */

check('paid-up completion → +8', 98, Loyalty::trustAfterComplete(90, true));
check('completion with money owing → +3', 93, Loyalty::trustAfterComplete(90, false));
check('default is the paid-up completion', 98, Loyalty::trustAfterComplete(90));
check('settling a played game → +5, landing on the same 8', 98, Loyalty::trustAfterPaid(93));
check('trust never passes 100', 100, Loyalty::trustAfterPaid(99));
check('cancel → −15', 85, Loyalty::trustAfterCancel(100));
check('cancel floors at 0', 0, Loyalty::trustAfterCancel(10));

/* ── the report ───────────────────────────────────────────────────────────── */

if ($failures !== []) {
    echo "\n";
    foreach ($failures as $failure) {
        echo "  ✗ {$failure}\n";
    }
    echo "\n".count($failures)." of {$checks} checks failed.\n";
    exit(1);
}

echo "loyalty rating ok ({$checks} checks)\n";
