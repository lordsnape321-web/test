<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One court's hours for one weekday.
 *
 * `courts.opens_at`/`closes_at` are the every-day window; a row here replaces
 * them for that weekday only (0 = Sunday … 6 = Saturday), which is how a turf
 * that runs 18:00–23:00 on Fridays keeps a 06:00–22:00 window the rest of the
 * week.
 */
class CourtDayHour extends Model
{
    use CamelCasedAttributes;

    /**
     * @var list<string>
     */
    protected $fillable = [
        'court_id',
        'day_of_week',
        'opens_at',
        'closes_at',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'court_id' => 'integer',
            'day_of_week' => 'integer',
        ];
    }

    public function court(): BelongsTo
    {
        return $this->belongsTo(Court::class, 'court_id');
    }
}
