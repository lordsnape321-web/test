<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * The same consent rule as a join request, pointed the other way: nobody is
 * added to a squad without saying yes. `created_at` doubles as "last sent",
 * because a declined or withdrawn invite is reopened in place — and that is
 * what the daily invite quota counts.
 */
class TeamInvite extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'team_invites';

    /**
     * @var list<string>
     */
    protected $fillable = ['team_id', 'user_id', 'invited_by', 'message', 'status', 'decided_at', 'decided_by'];

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
