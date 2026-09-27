<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class MatchJoin extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'match_joins';

    /**
     * @var list<string>
     */
    protected $fillable = ['match_id', 'user_id', 'status', 'joined_at'];

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
