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
     * `status` is a decision, not a fact: taking a spot files a pending request
     * and only the host's answer writes `accepted`. See `App\Support\OpenGames`.
     *
     * @var list<string>
     */
    protected $fillable = [
        'match_id', 'user_id', 'status', 'joined_at',
        'position', 'message',
        'paid_amount', 'pay_method', 'payment_ref', 'paid_at',
        'payment_requested_at', 'auto_accepted',
        'decided_at', 'decided_by',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'joined_at' => 'datetime',
            'paid_at' => 'datetime',
            'payment_requested_at' => 'datetime',
            'decided_at' => 'datetime',
            'paid_amount' => 'integer',
            'auto_accepted' => 'boolean',
        ];
    }
}
