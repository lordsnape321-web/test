<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * A player asking to join a squad. Asking no longer adds you to the roster: the
 * request waits until the captain accepts or declines it.
 */
class TeamRequest extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'team_requests';

    /**
     * @var list<string>
     */
    protected $fillable = ['team_id', 'user_id', 'message', 'status', 'decided_at', 'decided_by'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'decided_at' => 'datetime',
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
