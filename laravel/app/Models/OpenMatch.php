<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * An open match: one pitch, one score, players joining as individuals.
 */
class OpenMatch extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'open_matches';

    /**
     * `positions_needed` is a JSON array of the spots this host is short of,
     * and it is what makes the host's queue answerable rather than a free
     * slot anyone can take. Empty/absent means "anyone welcome".
     *
     * @var list<string>
     */
    protected $fillable = [
        'title', 'venue_id', 'court_id', 'organizer_id', 'date', 'start_time', 'end_time',
        'price_per_player', 'max_players', 'crew_size', 'level', 'status', 'description',
        'booking_id', 'charge_mode', 'positions_needed',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'price_per_player' => 'integer',
            'max_players' => 'integer',
            'crew_size' => 'integer',
        ];
    }

    /**
     * @return list<string>
     */
    protected function blankStringColumns(): array
    {
        return ['description'];
    }
}
