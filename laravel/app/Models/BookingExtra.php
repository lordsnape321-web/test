<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * A charge added after the court fee — the water and extra balls bought during
 * the game. The court price is taken in advance; these land later.
 */
class BookingExtra extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'booking_extras';

    /**
     * @var list<string>
     */
    protected $fillable = ['booking_id', 'label', 'amount', 'recorded_by', 'voided_at', 'voided_by'];

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
}
