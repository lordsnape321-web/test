<?php

namespace App\Support;

/**
 * Every field rule in the app, in one place — `src/lib/validation.ts`.
 *
 * Each helper returns `null` when the value is fine, or the exact message shown
 * to the player/owner. They are deliberately independent of the database: the
 * routes call them before touching a row, and the wording is shared with the
 * app so a rejection reads the same everywhere.
 *
 * The messages are copied verbatim, emoji included, because the Expo app and
 * the API tests were written against them.
 */
class Validation
{
    public const VALID_PAYMENTS = ['eSewa', 'Khalti', 'Cash at Venue'];

    public const VALID_CITIES = ['All Cities', 'Kathmandu', 'Lalitpur', 'Bhaktapur', 'Pokhara', 'Chitwan'];

    /** League caps — kept here so the routes and the wording cannot drift. */
    public const LEAGUE_MIN_TEAMS = 4;

    public const LEAGUE_MAX_TEAMS = 32;

    public const LEAGUE_NAME_MAX = 70;

    public const LEAGUE_DESCRIPTION_MAX = 600;

    public const LEAGUE_RULES_MAX = 800;

    public const LEAGUE_PRIZE_BREAKDOWN_MAX = 400;

    public const LEAGUE_MATCH_DAYS_MAX = 80;

    public const LEAGUE_MAX_ENTRY_FEE = 200000;

    public const LEAGUE_MAX_PRIZE_POOL = 2000000;

    public static function isBlank(mixed $v): bool
    {
        return $v === null || $v === false || trim((string) $v) === '';
    }

    public static function firstError(mixed ...$errors): ?string
    {
        foreach ($errors as $error) {
            if ($error) {
                return (string) $error;
            }
        }

        return null;
    }

    /* ------------------------------------------------------------- identity */

    public static function name(mixed $name, string $label = 'Name'): ?string
    {
        $t = trim((string) ($name ?? ''));

        if ($t === '') {
            return "{$label} is required — what should we call you? 🙂";
        }

        if (mb_strlen($t) < 2) {
            return "{$label} needs at least 2 letters";
        }

        if (mb_strlen($t) > 60) {
            return "{$label} is too long (max 60 characters)";
        }

        if (! preg_match('/^[A-Za-z][A-Za-z\s.\'-]*$/u', $t)) {
            return "{$label} can only have letters, spaces and . ' -";
        }

        if (preg_match('/\s{2,}/u', $t)) {
            return "{$label} has extra spaces — tidy it up a little ✨";
        }

        return null;
    }

    public static function email(mixed $email): ?string
    {
        $t = strtolower(trim((string) ($email ?? '')));

        if ($t === '') {
            return 'Email is required 📧';
        }

        if (mb_strlen($t) > 100) {
            return 'That email is too long (max 100 characters)';
        }

        if (! preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u', $t)) {
            return 'That doesn’t look like an email — try you@example.com 📧';
        }

        return null;
    }

    public static function normalizePhone(mixed $raw): string
    {
        return preg_replace('/[\s\-()]/', '', trim((string) ($raw ?? ''))) ?? '';
    }

    /**
     * @param  array{required?: bool}  $opts
     */
    public static function phone(mixed $phone, array $opts = []): ?string
    {
        $required = $opts['required'] ?? true;
        $t = self::normalizePhone($phone);

        if ($t === '') {
            return $required ? 'Phone number is required 📱 (one account per number)' : null;
        }

        if (! preg_match('/^\+?\d+$/', $t)) {
            return 'Phone can only have digits (and + at the start) 📱';
        }

        $digits = str_replace('+', '', $t);

        if (mb_strlen($digits) < 7) {
            return 'Phone is too short — needs 7–15 digits 📱';
        }

        if (mb_strlen($digits) > 15) {
            return 'Phone is too long — needs 7–15 digits 📱';
        }

        if (preg_match('/^(\d)\1{6,}$/', $digits)) {
            return 'That phone looks fake — please enter your real number 🙂';
        }

        return null;
    }

    /**
     * @param  array{min?: int, label?: string}  $opts
     */
    public static function password(mixed $pw, array $opts = []): ?string
    {
        $min = $opts['min'] ?? 6;
        $label = $opts['label'] ?? 'Password';
        $v = (string) ($pw ?? '');

        if ($v === '') {
            return "{$label} is required 🔒";
        }

        if (mb_strlen($v) < $min) {
            return "{$label} needs at least {$min} characters 🔒";
        }

        if (mb_strlen($v) > 100) {
            return "{$label} is too long (max 100 characters)";
        }

        if (preg_match('/^\s|\s$/', $v)) {
            return "{$label} can’t start or end with spaces";
        }

        if (in_array(strtolower($v), ['password', '123456', 'qwerty', 'futsal', 'abcdef', '111111'], true)) {
            return 'Too easy to guess — make it more unique! 🧠';
        }

        return null;
    }

    /* ---------------------------------------------------------------- text */

    /**
     * @param  array{max?: int, label?: string}  $opts
     */
    public static function search(mixed $q, array $opts = []): ?string
    {
        $max = $opts['max'] ?? 60;
        $t = trim((string) ($q ?? ''));

        if ($t === '') {
            return null;
        }

        if (mb_strlen($t) > $max) {
            return "Search is too long (max {$max} characters)";
        }

        if (preg_match('/<|>|`|\{|\}/', $t)) {
            return 'Search has odd characters — letters & numbers only 🔎';
        }

        return null;
    }

    /**
     * @param  array{min?: int, max?: int, label?: string}  $opts
     */
    public static function title(mixed $title, array $opts = []): ?string
    {
        $min = $opts['min'] ?? 3;
        $max = $opts['max'] ?? 60;
        $label = $opts['label'] ?? 'Title';
        $t = trim((string) ($title ?? ''));

        if ($t === '') {
            return "{$label} is required — give it some personality! ✨";
        }

        if (mb_strlen($t) < $min) {
            return "{$label} needs at least {$min} characters";
        }

        if (mb_strlen($t) > $max) {
            return "{$label} is too long (max {$max} characters)";
        }

        return null;
    }

    /**
     * @param  array{min?: int, max?: int, label?: string, required?: bool}  $opts
     */
    public static function message(mixed $msg, array $opts = []): ?string
    {
        $min = $opts['min'] ?? 3;
        $max = $opts['max'] ?? 1000;
        $label = $opts['label'] ?? 'Message';
        $required = $opts['required'] ?? true;
        $t = trim((string) ($msg ?? ''));

        if ($t === '') {
            return $required ? "{$label} is required — a few words help a lot! 💬" : null;
        }

        if (mb_strlen($t) < $min) {
            return "{$label} needs at least {$min} characters";
        }

        if (mb_strlen($t) > $max) {
            return "{$label} is too long (max {$max} characters)";
        }

        return null;
    }

    public static function notes(mixed $notes): ?string
    {
        $t = trim((string) ($notes ?? ''));

        if ($t === '') {
            return null;
        }

        if (mb_strlen($t) > 500) {
            return 'Notes are too long (max 500 characters) 📝';
        }

        return null;
    }

    public static function description(mixed $desc, array $opts = []): ?string
    {
        $t = trim((string) ($desc ?? ''));
        $max = $opts['max'] ?? 1000;

        if ($t === '') {
            return ($opts['required'] ?? false) ? 'Description is required — tell your story! 💛' : null;
        }

        if (mb_strlen($t) < 10) {
            return 'Description needs at least 10 characters 💛';
        }

        if (mb_strlen($t) > $max) {
            return "Description is too long (max {$max} characters)";
        }

        return null;
    }

    /* --------------------------------------------------------------- money */

    /**
     * @param  array{min?: int, max?: int, label?: string}  $opts
     */
    public static function money(mixed $n, array $opts = []): ?string
    {
        $min = $opts['min'] ?? 0;
        $max = $opts['max'] ?? 100000;
        $label = $opts['label'] ?? 'Price';

        if ($n === '' || $n === null || $n === false || $n === []) {
            return "{$label} is required 💰";
        }

        if (! is_numeric($n)) {
            return "{$label} must be a number 💰";
        }

        $v = (float) $n;

        if (! is_finite($v) || floor($v) != $v) {
            return "{$label} must be a whole number (no decimals) 💰";
        }

        if ($v < $min) {
            return "{$label} must be at least ".Futsal::formatNPR($min).' 💰';
        }

        if ($v > $max) {
            return "{$label} is too high (max ".Futsal::formatNPR($max).') 💰';
        }

        return null;
    }

    /**
     * @param  array{min?: int, max?: int, label?: string}  $opts
     */
    public static function crew(mixed $n, array $opts = []): ?string
    {
        $min = $opts['min'] ?? 1;
        $max = $opts['max'] ?? 21;
        $label = $opts['label'] ?? 'Players';

        if ($n === '' || $n === null || $n === false || $n === []) {
            return "{$label} is required 👥";
        }

        if (! is_numeric($n)) {
            return "{$label} must be a whole number 👥";
        }

        $v = (float) $n;

        if (! is_finite($v) || floor($v) != $v) {
            return "{$label} must be a whole number 👥";
        }

        if ($v < $min) {
            return "{$label} needs at least {$min} 👥";
        }

        if ($v > $max) {
            return "{$label} can’t be more than {$max} 👥";
        }

        return null;
    }

    public static function totalPlayers(mixed $total): ?string
    {
        if (! is_numeric($total)) {
            return 'Total players must be a number 🤝';
        }

        if ((float) $total < 4) {
            return 'You need at least 4 players total for a proper game 🤝';
        }

        if ((float) $total > 22) {
            return 'Max 22 players total — that’s already a festival! 🎪';
        }

        return null;
    }

    /**
     * @param  array{total?: int, openSpots?: int, max?: int}  $opts
     */
    public static function customPrice(mixed $custom, array $opts = []): ?string
    {
        if ($custom === '' || $custom === null || $custom === false) {
            return 'Set a price per joiner — or switch back to auto-split 💰';
        }

        if (! is_numeric($custom)) {
            return 'Custom price must be a whole number 💰';
        }

        $v = (float) $custom;

        if (! is_finite($v) || floor($v) != $v) {
            return 'Custom price must be a whole number 💰';
        }

        if ($v < 0) {
            return 'Custom price can’t be negative 🙂';
        }

        $max = $opts['max'] ?? 10000;

        if ($v > $max) {
            return 'Custom price is too high (max '.Futsal::formatNPR($max).') 💰';
        }

        return null;
    }

    /* ------------------------------------------------------ date and time */

    /**
     * @param  array{label?: string, allowPast?: bool, maxDaysAhead?: int}  $opts
     */
    public static function dateISO(mixed $date, array $opts = []): ?string
    {
        $label = $opts['label'] ?? 'Date';
        $t = trim((string) ($date ?? ''));

        if ($t === '') {
            return "{$label} is required 📅";
        }

        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $t)) {
            return "{$label} looks wrong (use YYYY-MM-DD) 📅";
        }

        try {
            $d = now()->parse($t.' 00:00:00')->startOfDay();
        } catch (\Throwable) {
            return "{$label} isn’t a real date 📅";
        }

        $today = now()->startOfDay();

        if (empty($opts['allowPast']) && $d->lessThan($today)) {
            return "{$label} can’t be in the past — pick today or later 📅";
        }

        if (! empty($opts['maxDaysAhead'])) {
            $max = $today->copy()->addDays((int) $opts['maxDaysAhead']);

            if ($d->greaterThan($max)) {
                return "{$label} is too far ahead (max {$opts['maxDaysAhead']} days) 📅";
            }
        }

        return null;
    }

    public static function timeHM(mixed $time, string $label = 'Time'): ?string
    {
        $t = trim((string) ($time ?? ''));

        if ($t === '') {
            return "{$label} is required 🕐";
        }

        if (! preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $t)) {
            return "{$label} looks wrong (use HH:MM) 🕐";
        }

        return null;
    }

    public static function hours(mixed $h): ?string
    {
        return in_array((int) $h, [1, 2, 3], true) ? null : 'Pick 1, 2 or 3 hours ⏱️';
    }

    /* ------------------------------------------------------------- venues */

    public static function venueName(mixed $name): ?string
    {
        return self::title($name, ['min' => 3, 'max' => 80, 'label' => 'Venue name']);
    }

    public static function address(mixed $addr): ?string
    {
        $t = trim((string) ($addr ?? ''));

        if ($t === '') {
            return 'Address is required — players need to find you! 📍';
        }

        if (mb_strlen($t) < 5) {
            return 'Address is too short — add area + city 📍';
        }

        if (mb_strlen($t) > 200) {
            return 'Address is too long (max 200 characters)';
        }

        return null;
    }

    public static function hoursRange(mixed $open, mixed $close): ?string
    {
        if (! is_numeric($open) || ! is_numeric($close)) {
            return 'Opening and closing hours must be numbers 🕐';
        }

        $o = (int) $open;
        $c = (int) $close;

        if ((float) $open != $o || $o < 0 || $o > 23) {
            return 'Opening hour must be 0–23 🕐';
        }

        if ((float) $close != $c || $c < 1 || $c > 24) {
            return 'Closing hour must be 1–24 🕐';
        }

        if ($c <= $o) {
            return 'Closing time must be after opening time 🕐';
        }

        if ($c - $o < 2) {
            return 'Venue should be open at least 2 hours a day 🕐';
        }

        if ($c - $o > 20) {
            return 'That’s a marathon day! Keep it under 20 hours 😅';
        }

        return null;
    }

    public static function courtName(mixed $name): ?string
    {
        return self::title($name, ['min' => 2, 'max' => 60, 'label' => 'Court name']);
    }

    public static function paymentMethods(mixed $methods): ?string
    {
        if (! is_array($methods)) {
            return 'Pick at least one payment method 💳';
        }

        $clean = array_values(array_filter(array_map(fn ($m) => trim((string) $m), $methods), fn ($m) => $m !== ''));

        if ($clean === []) {
            return 'Pick at least one payment method 💳 — cash, eSewa or Khalti';
        }

        $bad = array_values(array_filter($clean, fn ($m) => ! in_array($m, self::VALID_PAYMENTS, true)));

        if ($bad !== []) {
            return 'Unknown payment method: '.implode(', ', $bad).' 💳';
        }

        return null;
    }

    public static function depositPercent(mixed $p): ?string
    {
        if ($p === '' || $p === null || $p === false) {
            return 'Deposit % is required 🛡️';
        }

        if (! is_numeric($p)) {
            return 'Deposit % must be a whole number 🛡️';
        }

        $v = (float) $p;

        if (! is_finite($v) || floor($v) != $v) {
            return 'Deposit % must be a whole number 🛡️';
        }

        if ($v < 0) {
            return 'Deposit % can’t be negative 🙂';
        }

        if ($v > 100) {
            return 'Deposit % can’t be more than 100 🛡️';
        }

        if ($v > 0 && $v < 10) {
            return 'Deposit must be 0 (off) or at least 10% 🛡️';
        }

        return null;
    }

    public static function city(mixed $city, string $label = 'City'): ?string
    {
        $t = trim((string) ($city ?? ''));

        if ($t === '') {
            return "{$label} is required 📍";
        }

        if (! in_array($t, self::VALID_CITIES, true)) {
            return 'Pick a valid city 📍';
        }

        return null;
    }

    public static function avatarUrl(mixed $url): ?string
    {
        $t = trim((string) ($url ?? ''));

        if ($t === '') {
            return null;
        }

        if (strlen($t) > 2000000) {
            return 'Photo is too large — use under 2.5MB 📸';
        }

        if (str_starts_with($t, 'data:image/')) {
            return null;
        }

        if (preg_match('#^https?://.+\..+#', $t)) {
            return null;
        }

        return 'Photo must be an uploaded image or https link 📸';
    }

    /* --------------------------------------------------------- promo codes */

    public static function promoCode(mixed $code): ?string
    {
        $raw = trim((string) ($code ?? ''));

        if ($raw === '') {
            return 'Promo code is required 🎟️';
        }

        $t = Promos::normalizeCode($raw);

        if (mb_strlen($t) < Promos::CODE_MIN) {
            return 'Promo code needs at least '.Promos::CODE_MIN.' characters 🎟️';
        }

        if (mb_strlen($t) > Promos::CODE_MAX) {
            return 'Promo code is too long (max '.Promos::CODE_MAX.' characters) 🎟️';
        }

        if (! preg_match('/^[A-Z0-9-]+$/', $t)) {
            return 'Promo code can only have letters, numbers and dashes 🎟️';
        }

        if (! preg_match('/^[A-Z0-9]/', $t) || ! preg_match('/[A-Z0-9]$/', $t)) {
            return 'Promo code should start and end with a letter or number 🎟️';
        }

        if (preg_match('/^-{2,}/', $t) || preg_match('/\d{8,}/', $t)) {
            return 'That promo code is a bit odd — keep it simple 🎟️';
        }

        if (in_array($t, ['FREE', 'FREEPLAY', 'PROMO', 'DISCOUNT', 'ADMIN', 'NULL'], true)) {
            return "\"{$t}\" is reserved — pick something more specific 🎟️";
        }

        return null;
    }

    public static function promoTitle(mixed $title): ?string
    {
        return self::title($title, ['min' => 3, 'max' => 60, 'label' => 'Promo name']);
    }

    public static function discountType(mixed $type): ?string
    {
        return in_array((string) $type, Promos::DISCOUNT_TYPES, true) ? null : 'Pick percent or flat discount 🎟️';
    }

    public static function discountValue(mixed $value, mixed $type): ?string
    {
        $kind = ((string) $type === 'flat') ? 'flat' : 'percent';

        if ($value === '' || $value === null || $value === false) {
            return $kind === 'flat' ? 'How many rupees off? 💸' : 'What % off? 💸';
        }

        if (! is_numeric($value)) {
            return 'Discount must be a whole number 💸';
        }

        $v = (float) $value;

        if (! is_finite($v) || floor($v) != $v) {
            return 'Discount must be a whole number 💸';
        }

        if ($v <= 0) {
            return 'Discount must be more than 0 — otherwise it’s not a discount 🙂';
        }

        if ($kind === 'percent') {
            return $v > Promos::MAX_PERCENT ? 'Percent off can’t be more than '.Promos::MAX_PERCENT.' 💸' : null;
        }

        return $v > Promos::MAX_FLAT ? 'Flat discount is too big (max '.Futsal::formatNPR(Promos::MAX_FLAT).') 💸' : null;
    }

    /** 0 = no cap. */
    public static function maxDiscount(mixed $value): ?string
    {
        if ($value === '' || $value === null || $value === false) {
            return null;
        }

        if (! is_numeric($value)) {
            return 'Discount cap must be a whole number 🧢';
        }

        $v = (float) $value;

        if (! is_finite($v) || floor($v) != $v) {
            return 'Discount cap must be a whole number 🧢';
        }

        if ($v < 0) {
            return 'Discount cap can’t be negative 🧢';
        }

        return $v > Promos::MAX_CAP ? 'Discount cap is too big (max '.Futsal::formatNPR(Promos::MAX_CAP).') 🧢' : null;
    }

    public static function minBookingAmount(mixed $value): ?string
    {
        if ($value === '' || $value === null || $value === false) {
            return null;
        }

        if (! is_numeric($value)) {
            return 'Minimum booking must be a whole number 💰';
        }

        $v = (float) $value;

        if (! is_finite($v) || floor($v) != $v) {
            return 'Minimum booking must be a whole number 💰';
        }

        if ($v < 0) {
            return 'Minimum booking can’t be negative 💰';
        }

        return $v > Promos::MAX_CAP ? 'Minimum booking is too big (max '.Futsal::formatNPR(Promos::MAX_CAP).') 💰' : null;
    }

    /** 0 = unlimited. */
    public static function usageLimit(mixed $value, string $label = 'Usage limit'): ?string
    {
        if ($value === '' || $value === null || $value === false) {
            return null;
        }

        if (! is_numeric($value)) {
            return "{$label} must be a whole number 🔢";
        }

        $v = (float) $value;

        if (! is_finite($v) || floor($v) != $v) {
            return "{$label} must be a whole number 🔢";
        }

        if ($v < 0) {
            return "{$label} can’t be negative (0 = unlimited) 🔢";
        }

        return $v > 100000 ? "{$label} is too big (max 100,000) 🔢" : null;
    }

    public static function promoWindow(mixed $startsAt, mixed $expiresAt): ?string
    {
        $start = trim((string) ($startsAt ?? ''));
        $end = trim((string) ($expiresAt ?? ''));

        if ($end === '') {
            return 'Expiry date is required — when does this code stop working? 📅';
        }

        if (! Promos::isValidDateISO($end)) {
            return 'Expiry date looks wrong (use YYYY-MM-DD) 📅';
        }

        if ($start !== '' && ! Promos::isValidDateISO($start)) {
            return 'Start date looks wrong (use YYYY-MM-DD) 📅';
        }

        if ($start !== '' && $start > $end) {
            return 'Start date must be on or before the expiry date 📅';
        }

        $today = Promos::dateISO();

        if ($end < $today) {
            return 'Expiry date can’t be in the past — nobody could use it 📅';
        }

        $far = now()->addDays(Promos::MAX_DAYS_AHEAD)->toDateString();

        return $end > $far ? 'Expiry is too far ahead (max '.Promos::MAX_DAYS_AHEAD.' days) 📅' : null;
    }

    /* --------------------------------------------------------------- teams */

    /**
     * The handle players search a squad by. Uniqueness is checked against the
     * database in the teams route, not here.
     *
     * @param  array{required?: bool}  $opts
     */
    public static function teamCode(mixed $code, array $opts = []): ?string
    {
        $raw = trim((string) ($code ?? ''));

        if ($raw === '') {
            return ($opts['required'] ?? true) === false ? null : 'Your team needs a unique code so others can find it 🛡️';
        }

        $t = Teams::normalizeCode($raw);

        if (mb_strlen($t) < Teams::CODE_MIN) {
            return 'Team code needs at least '.Teams::CODE_MIN.' characters 🛡️';
        }

        if (mb_strlen($t) > Teams::CODE_MAX) {
            return 'Team code is too long (max '.Teams::CODE_MAX.' characters) 🛡️';
        }

        if (! preg_match('/^[A-Z0-9-]+$/', $t)) {
            return 'Team code can only have letters, numbers and dashes 🛡️';
        }

        if (! preg_match('/^[A-Z0-9]/', $t) || ! preg_match('/[A-Z0-9]$/', $t)) {
            return 'Team code should start and end with a letter or number 🛡️';
        }

        if (preg_match('/^-{2,}/', $t) || preg_match('/\d{8,}/', $t)) {
            return 'That team code is a bit odd — keep it simple 🛡️';
        }

        if (in_array($t, ['TEAM', 'TEAMS', 'ADMIN', 'NULL', 'SEARCH', 'JOIN', 'NONE'], true)) {
            return "\"{$t}\" is reserved — pick something specific to your squad 🛡️";
        }

        return null;
    }

    public static function joinMessage(mixed $msg): ?string
    {
        $t = trim((string) ($msg ?? ''));

        return $t === '' ? null : (mb_strlen($t) > 200 ? 'Keep your join note under 200 characters 📝' : null);
    }

    public static function inviteMessage(mixed $msg): ?string
    {
        $t = trim((string) ($msg ?? ''));

        return $t === '' ? null : (mb_strlen($t) > 200 ? 'Keep your invite note under 200 characters 📝' : null);
    }

    public static function teamDescription(mixed $desc): ?string
    {
        $t = trim((string) ($desc ?? ''));

        if ($t === '') {
            return null;
        }

        if (mb_strlen($t) < 10) {
            return 'Give the description a little more to say — at least 10 characters ✍️';
        }

        return mb_strlen($t) > Teams::DESCRIPTION_MAX
            ? 'Team description is too long (max '.Teams::DESCRIPTION_MAX.' characters) 📝'
            : null;
    }

    /**
     * The squad selector on a booking: blank or 0 means "individual booking"
     * and is always allowed. Membership is verified server-side.
     */
    public static function teamId(mixed $value): ?string
    {
        if (self::isBlank($value) || (int) $value === 0) {
            return null;
        }

        $n = (float) $value;

        return (! is_numeric($value) || floor($n) != $n || $n <= 0) ? 'Pick one of your teams, or book individually 🛡️' : null;
    }

    /* ------------------------------------------------------------- leagues */

    public static function leagueName(mixed $name): ?string
    {
        $t = trim((string) ($name ?? ''));

        if ($t === '') {
            return 'Give the league a name — captains need something to share 📣';
        }

        if (mb_strlen($t) < 3) {
            return 'League name needs at least 3 characters 📣';
        }

        return mb_strlen($t) > self::LEAGUE_NAME_MAX
            ? 'League name is too long (max '.self::LEAGUE_NAME_MAX.' characters) 📣'
            : null;
    }

    public static function maxTeams(mixed $value): ?string
    {
        if (! is_numeric($value)) {
            return 'How many teams? Pick a whole number 👥';
        }

        $n = (float) $value;

        if (floor($n) != $n) {
            return 'How many teams? Pick a whole number 👥';
        }

        if ($n < self::LEAGUE_MIN_TEAMS) {
            return 'A league needs at least '.self::LEAGUE_MIN_TEAMS.' squads to be worth a table 👥';
        }

        return $n > self::LEAGUE_MAX_TEAMS ? 'Max '.self::LEAGUE_MAX_TEAMS.' squads — split it into two leagues! 👥' : null;
    }

    public static function entryFee(mixed $value): ?string
    {
        if (self::isBlank($value)) {
            return 'Entry fee is required — put 0 for a free league 💰';
        }

        if (! is_numeric($value)) {
            return 'Entry fee must be a whole number of rupees 💰';
        }

        $n = (float) $value;

        if (floor($n) != $n || $n < 0) {
            return 'Entry fee must be a whole number of rupees 💰';
        }

        return $n > self::LEAGUE_MAX_ENTRY_FEE
            ? 'Entry fee is too high (max '.Futsal::formatNPR(self::LEAGUE_MAX_ENTRY_FEE).') 💰'
            : null;
    }

    public static function prizePool(mixed $value): ?string
    {
        if (self::isBlank($value)) {
            return null;
        }

        if (! is_numeric($value)) {
            return 'Prize pool must be a whole number of rupees 🏆';
        }

        $n = (float) $value;

        if (floor($n) != $n || $n < 0) {
            return 'Prize pool must be a whole number of rupees 🏆';
        }

        return $n > self::LEAGUE_MAX_PRIZE_POOL
            ? 'Prize pool is too high (max '.Futsal::formatNPR(self::LEAGUE_MAX_PRIZE_POOL).') 🏆'
            : null;
    }

    /**
     * The prize split, one line per place. Optional, but when it is there it
     * should read as a list.
     */
    public static function prizeBreakdown(mixed $text): ?string
    {
        $t = trim((string) ($text ?? ''));

        if ($t === '') {
            return null;
        }

        if (mb_strlen($t) > self::LEAGUE_PRIZE_BREAKDOWN_MAX) {
            return 'Prize list is too long (max '.self::LEAGUE_PRIZE_BREAKDOWN_MAX.' characters) 🏆';
        }

        $lines = array_values(array_filter(array_map('trim', preg_split('/\R/u', $t) ?: []), fn ($l) => $l !== ''));

        if (count($lines) > 12) {
            return 'Keep the prize list to 12 lines — a table, not a novel 🏆';
        }

        foreach ($lines as $line) {
            if (mb_strlen($line) < 3) {
                return 'Each prize line needs a little more detail 🏆';
            }
        }

        return null;
    }

    public static function matchDays(mixed $text): ?string
    {
        $t = trim((string) ($text ?? ''));

        return $t !== '' && mb_strlen($t) > self::LEAGUE_MATCH_DAYS_MAX
            ? 'Match days are too long (max '.self::LEAGUE_MATCH_DAYS_MAX.' characters) 🗓️'
            : null;
    }

    /**
     * Start date is required — a league with no start date cannot be planned
     * for. End and closing dates are optional, but must be in order.
     */
    public static function leagueDates(mixed $startsAt, mixed $endsAt = null, mixed $closesAt = null): ?string
    {
        $start = trim((string) ($startsAt ?? ''));
        $end = trim((string) ($endsAt ?? ''));
        $close = trim((string) ($closesAt ?? ''));

        $startErr = self::dateISO($start, ['label' => 'Start date', 'allowPast' => true]);

        if ($startErr) {
            return $startErr;
        }

        if ($end !== '') {
            $endErr = self::dateISO($end, ['label' => 'Final date', 'allowPast' => true]);

            if ($endErr) {
                return $endErr;
            }

            if ($end < $start) {
                return 'The final date can’t be before the start date 🗓️';
            }
        }

        if ($close !== '') {
            $closeErr = self::dateISO($close, ['label' => 'Entry deadline', 'allowPast' => true]);

            if ($closeErr) {
                return $closeErr;
            }

            if ($end !== '' && $close > $end) {
                return 'Entry deadline can’t be after the final date 🗓️';
            }
        }

        return null;
    }

    /**
     * @param  array{label: string, max: int}  $opts
     */
    public static function leagueText(mixed $text, array $opts): ?string
    {
        $t = trim((string) ($text ?? ''));

        return $t !== '' && mb_strlen($t) > $opts['max']
            ? "{$opts['label']} is too long (max {$opts['max']} characters) 📝"
            : null;
    }

    /** Blank/undefined means "not entered", which is allowed. */
    public static function score(mixed $value, string $label = 'Score'): ?string
    {
        if ($value === '' || $value === null || $value === false) {
            return null;
        }

        if (! is_numeric($value)) {
            return "{$label} must be a whole number ⚽";
        }

        $n = (float) $value;

        if (! is_finite($n) || floor($n) != $n) {
            return "{$label} must be a whole number ⚽";
        }

        if ($n < 0) {
            return "{$label} can’t be negative ⚽";
        }

        return $n > 99 ? "{$label} looks wrong — max 99 ⚽" : null;
    }

    public static function round(mixed $value): ?string
    {
        $t = trim((string) ($value ?? ''));

        return $t !== '' && mb_strlen($t) > 30 ? 'Round name is too long (max 30 characters) 🏷️' : null;
    }

    public static function externalUrl(mixed $url): ?string
    {
        $t = trim((string) ($url ?? ''));

        if ($t === '') {
            return 'Paste the album link — e.g. a Google Drive or Facebook folder 🔗';
        }

        if (mb_strlen($t) > 500) {
            return 'That link is too long (max 500 characters) 🔗';
        }

        return preg_match('#^https?://[^\s]+\.[^\s]+#i', $t)
            ? null
            : 'Links must start with http:// or https:// and point at a real site 🔗';
    }
}
