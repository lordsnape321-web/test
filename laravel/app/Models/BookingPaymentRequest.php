<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * A captain's directed request for one teammate to pay a specific amount.
 * Separate from the equal team shares: the recipient pays the venue through
 * eSewa/Khalti without changing the roster split.
 */
class BookingPaymentRequest extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'booking_payment_requests';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'booking_id', 'requested_by', 'payer_id', 'amount_due', 'purpose', 'note',
        'payment_method', 'status', 'paid_amount', 'gateway_txn_id', 'esewa_uuid',
        'khalti_pidx', 'paid_at',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'amount_due' => 'integer',
            'paid_amount' => 'integer',
            'paid_at' => 'datetime',
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
