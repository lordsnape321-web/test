<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * One approved member's share when a player books for a squad. Each member pays
 * their own server-calculated share by the method they chose.
 */
class BookingTeamPayment extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'booking_team_payments';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'booking_id', 'team_id', 'user_id', 'amount_due', 'payment_method', 'payment_status',
        'paid_amount', 'gateway_txn_id', 'esewa_uuid', 'khalti_pidx',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'amount_due' => 'integer',
            'paid_amount' => 'integer',
        ];
    }
}
