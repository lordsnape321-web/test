<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * The league ledger: every rupee in and out, one row at a time.
 */
class TournamentPayment extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'tournament_payments';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'tournament_id', 'team_id', 'user_id', 'kind', 'amount', 'method', 'reference', 'recorded_by',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'amount' => 'integer',
        ];
    }
}
