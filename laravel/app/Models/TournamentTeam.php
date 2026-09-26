<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * Who is in the league, and how far along their entry is.
 */
class TournamentTeam extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'tournament_teams';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'tournament_id', 'team_id', 'status', 'requested_by', 'message', 'paid_amount',
        'refunded_amount', 'pay_method', 'receipt_url', 'gateway_txn_id', 'decided_by', 'decided_at',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'paid_amount' => 'integer',
            'refunded_amount' => 'integer',
            'decided_at' => 'datetime',
        ];
    }

    /**
     * @return list<string>
     */
    protected function blankStringColumns(): array
    {
        return ['message', 'receipt_url'];
    }
}
