<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class TeamMember extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'team_members';

    /**
     * @var list<string>
     */
    protected $fillable = ['team_id', 'user_id', 'role', 'joined_at'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'joined_at' => 'datetime',
        ];
    }
}
