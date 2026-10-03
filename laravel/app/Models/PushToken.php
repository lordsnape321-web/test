<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One phone that has agreed to be pushed to.
 *
 * The row is keyed by the Expo token, because that is what identifies a handset
 * — a player with a phone and a tablet has two rows and gets two buzzes, which
 * is what they asked for by installing twice.
 */
class PushToken extends Model
{
    /**
     * @var list<string>
     */
    protected $fillable = ['user_id', 'token', 'platform', 'device_name', 'last_seen_at'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'last_seen_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
