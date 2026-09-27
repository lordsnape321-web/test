<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * One review per player per venue. A player's review is updated in place when
 * they play there again, never duplicated.
 *
 * `updated_at` is data, not bookkeeping: it stays null until the player edits
 * their review, so Eloquent must not touch it. `CREATED_AT` is left alone.
 */
class Review extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    const UPDATED_AT = null;

    /**
     * @var list<string>
     */
    protected $fillable = ['venue_id', 'user_id', 'booking_id', 'rating', 'message', 'updated_at'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'rating' => 'integer',
        ];
    }

    /**
     * @return list<string>
     */
    protected function blankStringColumns(): array
    {
        return ['message'];
    }
}
