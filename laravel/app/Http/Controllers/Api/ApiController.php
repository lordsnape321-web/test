<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/**
 * Shared response helpers.
 *
 * Every route in the Next.js API answered in one of two shapes: a payload, or
 * `{ error: "..." }` with a status code. `apiJson()` in the Expo app reads
 * `body.error` to show the server's real message, so that envelope is the
 * contract — these two helpers keep every controller honest about it.
 */
abstract class ApiController extends Controller
{
    /**
     * @param  array<string, mixed>  $data
     */
    protected function ok(array $data = [], int $status = 200): JsonResponse
    {
        return response()->json($data, $status);
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    protected function fail(string $message, int $status = 400, array $extra = []): JsonResponse
    {
        return response()->json(['error' => $message, ...$extra], $status);
    }

    /** A positive integer id from a route parameter, or null when it isn't one. */
    protected function routeId(mixed $value): ?int
    {
        if (! is_numeric($value)) {
            return null;
        }

        $id = (int) $value;

        return $id > 0 ? $id : null;
    }

    /** "1,2,3" or ["1","2"] -> [1,2,3] with blanks and junk dropped. */
    protected function toIntList(mixed $value): array
    {
        $parts = is_array($value) ? $value : explode(',', (string) ($value ?? ''));

        return array_values(array_filter(array_map(
            fn ($v) => is_numeric($v) ? (int) $v : null,
            $parts
        ), fn ($v) => $v !== null && $v > 0));
    }

    /** Trim and cap a free-text field the way the Next.js routes did. */
    protected function text(mixed $value, int $max = 1000): string
    {
        return mb_substr(trim((string) ($value ?? '')), 0, $max);
    }
}
