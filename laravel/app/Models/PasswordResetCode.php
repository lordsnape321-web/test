<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * A six-digit "reset your password" code, stored hashed.
 *
 * @property string $email
 * @property string $code_hash
 * @property int $attempts
 */
class PasswordResetCode extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'password_reset_codes';

    /**
     * @var list<string>
     */
    protected $fillable = ['user_id', 'email', 'code_hash', 'attempts', 'expires_at', 'used_at'];

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
