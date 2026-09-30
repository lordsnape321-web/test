<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * A six-digit code we emailed someone, stored hashed.
 *
 * Three purposes share this table, told apart by `purpose` (see
 * `App\Services\EmailCodes`): resetting a password, verifying an address during
 * signup, and confirming that the account holder really wants their account
 * closed. They are the same mechanism — email a short-lived code, accept it once
 * — so they are the same table.
 *
 * @property string $email
 * @property string $purpose
 * @property string $code_hash
 * @property int $attempts
 */
class EmailCode extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'email_codes';

    /**
     * @var list<string>
     */
    protected $fillable = ['user_id', 'email', 'purpose', 'code_hash', 'attempts', 'expires_at', 'used_at'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'attempts' => 'integer',
            'expires_at' => 'datetime',
            'used_at' => 'datetime',
        ];
    }
}
