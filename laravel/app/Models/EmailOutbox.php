<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * One queued (or sent, or failed) email.
 *
 * @property string $to_email
 * @property string $subject
 * @property string $status
 * @property int $attempts
 */
class EmailOutbox extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'email_outbox';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'user_id', 'to_email', 'to_name', 'subject', 'template', 'type',
        'payload', 'status', 'attempts', 'error', 'available_at', 'sent_at',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'attempts' => 'integer',
            'available_at' => 'datetime',
            'sent_at' => 'datetime',
        ];
    }
}
