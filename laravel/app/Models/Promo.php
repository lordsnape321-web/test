<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * A discount code a venue owner hands out: percent or flat, optionally hidden
 * from the public list, with total and per-player redemption limits.
 *
 * Redemptions are counted from bookings rather than a counter column, so a
 * cancelled booking automatically gives the code back.
 */
class Promo extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    /**
     * @var list<string>
     */
    protected $fillable = [
        'venue_id', 'code', 'title', 'discount_type', 'discount_value', 'max_discount',
        'min_booking_amount', 'starts_at', 'expires_at', 'usage_limit', 'per_user_limit',
        'is_public', 'is_active',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'discount_value' => 'integer',
            'max_discount' => 'integer',
            'min_booking_amount' => 'integer',
            'usage_limit' => 'integer',
            'per_user_limit' => 'integer',
            'is_public' => 'boolean',
            'is_active' => 'boolean',
        ];
    }
}
