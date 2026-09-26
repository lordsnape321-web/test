<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A league: one ground, many squads, every team playing the others over weeks,
 * with an entry fee, a prize pool and a table that means something.
 */
class Tournament extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    /**
     * @var list<string>
     */
    protected $fillable = [
        'name', 'host_id', 'host_role', 'venue_id', 'court_id', 'format', 'mode',
        'third_place', 'group_size', 'max_teams', 'entry_fee', 'deposit_percent',
        'refund_percent', 'prize_pool', 'prize_breakdown', 'starts_at', 'ends_at',
        'closes_at', 'match_days', 'visibility', 'status', 'description', 'rules',
        'contact_phone', 'banner_url',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'third_place' => 'boolean',
            'group_size' => 'integer',
            'max_teams' => 'integer',
            'entry_fee' => 'integer',
            'deposit_percent' => 'integer',
            'refund_percent' => 'integer',
            'prize_pool' => 'integer',
        ];
    }

    /**
     * @return list<string>
     */
    protected function blankStringColumns(): array
    {
        return ['prize_breakdown', 'description', 'rules', 'banner_url'];
    }

    public function teams(): HasMany
    {
        return $this->hasMany(TournamentTeam::class, 'tournament_id');
    }

    public function matches(): HasMany
    {
        return $this->hasMany(TournamentMatch::class, 'tournament_id');
    }
}
