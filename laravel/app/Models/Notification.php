<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * A row in a player's or owner's bell.
 *
 * Deliberately not `Illuminate\Notifications\Notification`: it is the app's own
 * table, with its own `link` (a route in the Expo app, e.g. "/bookings").
 *
 * @method static \Illuminate\Database\Eloquent\Builder<static> forUser(int $userId)
 */
class Notification extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    /**
     * @var list<string>
     */
    protected $fillable = ['user_id', 'type', 'title', 'message', 'link', 'is_read'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_read' => 'boolean',
        ];
    }

    /**
     * @return list<string>
     */
    protected function blankStringColumns(): array
    {
        return ['message'];
    }

    /**
     * @param  \Illuminate\Database\Eloquent\Builder<static>  $query
     * @return \Illuminate\Database\Eloquent\Builder<static>
     */
    public function scopeForUser($query, int $userId)
    {
        return $query->where('user_id', $userId);
    }
}
