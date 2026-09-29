<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * One line in a captain's ledger: "this squad member handed over this much,
 * like this, on this date".
 *
 * @method static \Illuminate\Database\Eloquent\Builder<static> forBooking(int $bookingId)
 */
class TeamLedgerEntry extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'team_ledger_entries';

    protected $fillable = [
        'booking_id',
        'team_id',
        'user_id',
        'amount',
        'method',
        'note',
        'recorded_by',
        'voided_at',
        'voided_by',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'amount' => 'integer',
            'voided_at' => 'datetime',
        ];
    }

    /**
     * @param  \Illuminate\Database\Eloquent\Builder<static>  $query
     * @return \Illuminate\Database\Eloquent\Builder<static>
     */
    public function scopeForBooking($query, int $bookingId)
    {
        return $query->where('booking_id', $bookingId);
    }
}
