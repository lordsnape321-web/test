<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * One instalment on a booking. Append-only: a mistake made inside the settle
 * window is corrected by voiding the row, never by deleting it, so the history
 * of who entered what survives.
 */
class BookingPayment extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'booking_payments';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'booking_id', 'amount', 'method', 'note', 'source', 'reference', 'recorded_by', 'voided_at', 'voided_by',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'amount' => 'integer',
            'recorded_by' => 'integer',
            'voided_at' => 'datetime',
        ];
    }

    /**
     * @return list<string>
     */
    protected function blankStringColumns(): array
    {
        return ['note'];
    }
}
