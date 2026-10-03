<?php

/**
 * Everything `App\Support\Loyalty` needs that the framework normally provides.
 *
 * The class is deliberately pure arithmetic — that is what makes a rating rule
 * testable without a database, a request, or `composer install`. The only thing
 * it borrows from Laravel is the `now()` helper and the Carbon methods it calls
 * on the result, and this file stands in for exactly that much and no more:
 *
 *     `now()->parse($x)`, `->copy()`, `->startOfMonth()`,
 *     `->greaterThanOrEqualTo()`, `->getTimestamp()`
 *
 * Two scripts share it: `loyalty-rating.php` (readable checks) and
 * `loyalty-rate-json.php` (the machine-readable half the TypeScript mirror is
 * compared against). Neither needs composer, PHPUnit, or a database.
 */

declare(strict_types=1);

if (! function_exists('now')) {
    /** Stand-in for Illuminate's `now()`. */
    function now(): object
    {
        return new class
        {
            public function parse(mixed $value): object
            {
                return new DateStub((string) $value);
            }

            public function __toString(): string
            {
                return '2026-10-03 12:00:00';
            }
        };
    }
}

/** A date with only the methods `Loyalty` asks for. */
if (! class_exists('DateStub')) {
    class DateStub
    {
        private DateTimeImmutable $at;

        public function __construct(string $value)
        {
            $this->at = new DateTimeImmutable($value !== '' ? $value : 'now');
        }

        public function copy(): self
        {
            return new self($this->at->format('Y-m-d H:i:s'));
        }

        public function startOfMonth(): self
        {
            return new self($this->at->format('Y-m-01 00:00:00'));
        }

        public function greaterThanOrEqualTo(self $other): bool
        {
            return $this->at >= $other->at;
        }

        public function getTimestamp(): int
        {
            return $this->at->getTimestamp();
        }

        public function __toString(): string
        {
            return $this->at->format('Y-m-d H:i:s');
        }
    }
}

require_once __DIR__.'/../../app/Support/Loyalty.php';
