<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Team extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    /**
     * @var list<string>
     */
    protected $fillable = [
        'name', 'motto', 'description', 'team_code', 'captain_id', 'max_players',
        'level', 'logo_color', 'wins', 'losses', 'draws', 'home_ground',
        'home_venue_id', 'looking_for_players',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'captain_id' => 'integer',
            'max_players' => 'integer',
            'wins' => 'integer',
            'losses' => 'integer',
            'draws' => 'integer',
            'home_venue_id' => 'integer',
            'looking_for_players' => 'boolean',
        ];
    }

    /**
     * @return list<string>
     */
    protected function blankStringColumns(): array
    {
        return ['description'];
    }

    public function members(): HasMany
    {
        return $this->hasMany(TeamMember::class, 'team_id');
    }
}
