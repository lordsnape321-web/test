<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * A fixture: one game between two squads of the same league.
 *
 * Null scores mean "not played yet". The moment both numbers are in, the table
 * moves. `booking_id` links the fixture to the court booking holding the slot.
 */
class TournamentMatch extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'tournament_matches';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'tournament_id', 'round', 'bracket_round', 'slot', 'home_from', 'away_from',
        'home_label', 'away_label', 'home_team_id', 'away_team_id', 'date', 'start_time',
        'court_id', 'home_score', 'away_score', 'status', 'booking_id', 'notes', 'updated_by',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'bracket_round' => 'integer',
            'slot' => 'integer',
            'home_team_id' => 'integer',
            'away_team_id' => 'integer',
            'home_score' => 'integer',
            'away_score' => 'integer',
        ];
    }

    /**
     * @return list<string>
     */
    protected function blankStringColumns(): array
    {
        return ['notes'];
    }
}
