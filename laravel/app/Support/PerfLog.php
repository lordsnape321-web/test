<?php

namespace App\Support;

/**
 * A tiny request profiler: what was called, how long it took, and how much of
 * that was the database.
 *
 * The rule this was written under is "measure before changing anything else".
 * Three rounds of performance work went in on inference — the mail drain, the
 * batching, the indexes — and the honest position is that the remaining
 * slowness has an address, it just has not been read yet. This is the address:
 * every sample says which route, how many queries, how long in SQL, and how
 * long in total, so the next change is aimed rather than guessed.
 *
 * Cost is deliberately near zero:
 *
 *   • the writing request only appends one line, and only when the request was
 *     slow or it is the sampled one-in-N;
 *   • the file is capped, so a long-running dev server cannot fill a disk;
 *   • nothing here can throw into a request — telemetry is never worth a 500.
 */
class PerfLog
{
    /**
     * Record one request (or one batched read).
     *
     * @param  array{route: string, status: int, ms: float, queries?: int, db_ms?: float}  $sample
     */
    public static function record(array $sample): void
    {
        $config = config('perf', []);

        if (! ($config['enabled'] ?? false)) {
            return;
        }

        try {
            $ms = round((float) ($sample['ms'] ?? 0), 1);
            $slow = $ms >= (float) ($config['slow_ms'] ?? 250);
            $sampleRate = max(1, (int) ($config['sample'] ?? 10));

            if (! $slow && random_int(1, $sampleRate) !== 1) {
                return;
            }

            $line = json_encode([
                'at' => now()->toIso8601String(),
                'route' => (string) ($sample['route'] ?? '?'),
                'status' => (int) ($sample['status'] ?? 0),
                'ms' => $ms,
                'queries' => (int) ($sample['queries'] ?? 0),
                'db_ms' => round((float) ($sample['db_ms'] ?? 0), 1),
            ], JSON_UNESCAPED_SLASHES);

            if ($line === false) {
                return;
            }

            $path = (string) ($config['path'] ?? storage_path('framework/perf.jsonl'));

            $size = @filesize($path);

            if ($size !== false && $size > (int) ($config['max_bytes'] ?? 512 * 1024)) {
                @unlink($path);
            }

            @file_put_contents($path, $line."\n", FILE_APPEND | LOCK_EX);
        } catch (\Throwable $e) {
            // Never let measuring the app break the app.
        }
    }

    /**
     * What the last few hundred requests looked like, for `GET /api/health`.
     *
     * @return array<string, mixed>
     */
    public static function summary(): array
    {
        $config = config('perf', []);

        if (! ($config['enabled'] ?? false)) {
            return ['enabled' => false];
        }

        $path = (string) ($config['path'] ?? storage_path('framework/perf.jsonl'));

        if (! is_file($path)) {
            return ['enabled' => true, 'samples' => 0];
        }

        try {
            $lines = @file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        } catch (\Throwable $e) {
            return ['enabled' => true, 'samples' => 0];
        }

        $window = array_slice($lines, -max(1, (int) ($config['read_samples'] ?? 300)));

        $samples = [];

        foreach ($window as $line) {
            $row = json_decode($line, true);

            if (is_array($row) && isset($row['ms'])) {
                $samples[] = $row;
            }
        }

        if ($samples === []) {
            return ['enabled' => true, 'samples' => 0];
        }

        $times = array_map(fn ($row) => (float) $row['ms'], $samples);
        sort($times);

        $slowest = $samples;
        usort($slowest, fn ($a, $b) => ($b['ms'] ?? 0) <=> ($a['ms'] ?? 0));

        return [
            'enabled' => true,
            'samples' => count($samples),
            'since' => (string) ($samples[0]['at'] ?? ''),
            'median_ms' => round(self::percentile($times, 50), 1),
            'p95_ms' => round(self::percentile($times, 95), 1),
            // The rows worth looking at: same route, same query count, repeatably.
            'slowest' => array_map(fn ($row) => [
                'route' => (string) ($row['route'] ?? '?'),
                'ms' => (float) ($row['ms'] ?? 0),
                'queries' => (int) ($row['queries'] ?? 0),
                'db_ms' => (float) ($row['db_ms'] ?? 0),
                'status' => (int) ($row['status'] ?? 0),
                'at' => (string) ($row['at'] ?? ''),
            ], array_slice($slowest, 0, max(1, (int) ($config['slowest'] ?? 6)))),
        ];
    }

    /** @param list<float> $sorted */
    private static function percentile(array $sorted, int $percent): float
    {
        if ($sorted === []) {
            return 0.0;
        }

        $index = (int) ceil(($percent / 100) * count($sorted)) - 1;

        return $sorted[max(0, min(count($sorted) - 1, $index))];
    }
}
