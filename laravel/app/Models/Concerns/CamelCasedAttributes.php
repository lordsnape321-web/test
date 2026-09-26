<?php

namespace App\Models\Concerns;

use Illuminate\Support\Str;

/**
 * Serialise models with camelCase keys.
 *
 * The app's TypeScript types were read off live responses from the Next.js API,
 * where Drizzle maps `created_at` to `createdAt`, `price_per_hour` to
 * `pricePerHour` and so on. The columns stay snake_case in MySQL (that is what
 * Eloquent and every migration expect); this converts the *outgoing* JSON, and
 * only the outgoing JSON, so the app sees exactly the shape it was written
 * against.
 *
 * It is applied in `toArray()` rather than `attributesToArray()` so that
 * eagerly-loaded relations — a booking's `venue` and `court`, a match's
 * `players` — are converted too: `toArray()` already walks into each relation
 * and calls `toArray()` on it, so converting the finished array reaches every
 * level of nesting in one pass.
 */
trait CamelCasedAttributes
{
    /**
     * Convert the model's array form to camelCase keys.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $array = $this->camelCaseKeys(parent::toArray());

        // MySQL cannot give a TEXT column a default, so a row written without
        // an image or a note comes back as null. The Next.js API always sent ""
        // and the app renders these fields straight into <Image source={{uri}}>,
        // where null is a crash and "" is "no picture".
        foreach ($this->blankStringColumns() as $column) {
            $key = Str::camel($column);

            if (array_key_exists($key, $array) && $array[$key] === null) {
                $array[$key] = '';
            }
        }

        return $array;
    }

    /**
     * Columns the app expects to read as "" rather than null.
     *
     * @return list<string>
     */
    protected function blankStringColumns(): array
    {
        return [];
    }

    /**
     * Recursively camelCase the keys of an array.
     *
     * Lists (a booking's `payments`, a match's `players`) are walked element by
     * element so nested models are converted as well. The pivot object is left
     * alone: its keys are column names the app never reads.
     *
     * @param  array<int|string, mixed>  $array
     * @return array<int|string, mixed>
     */
    protected function camelCaseKeys(array $array): array
    {
        $out = [];

        foreach ($array as $key => $value) {
            if (is_string($key) && $key === 'pivot') {
                $out[$key] = $value;

                continue;
            }

            $camel = is_string($key) ? Str::camel($key) : $key;

            $out[$camel] = is_array($value) ? $this->camelCaseKeys($value) : $value;
        }

        return $out;
    }

    /**
     * Format dates the way `JSON.stringify(new Date())` did on the Next.js side:
     * ISO-8601 UTC with milliseconds, e.g. "2024-05-01T04:15:00.000Z".
     */
    protected function serializeDate(\DateTimeInterface $date): string
    {
        return $date->format('Y-m-d\TH:i:s.v\Z');
    }
}
