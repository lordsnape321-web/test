<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

/**
 * A player, a venue owner or an admin.
 *
 * Passwords use the established sha256("futsal-nepal::auth-v1::" . password)
 * format rather than bcrypt. `App\Support\LegacyPassword` keeps existing
 * migrated accounts usable while the service remains compatible with the
 * mobile client.
 */
class User extends Authenticatable
{
    use CamelCasedAttributes;
    use HasFactory;
    use Notifiable;

    protected $table = 'users';

    /**
     * @var list<string>
     */
    protected $fillable = [
        'name',
        'email',
        'phone',
        'password_hash',
        'role',
        'avatar_color',
        'avatar_url',
        'default_city',
        'level',
        'position',
        'matches_played',
        'trust_score',
        'email_notifications',
        'email_reminders',
        'reminder_minutes',
    ];

    /**
     * Never let a password hash escape in a response, whatever the route does.
     *
     * @var list<string>
     */
    protected $hidden = ['password_hash'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'matches_played' => 'integer',
            'trust_score' => 'integer',
            // Opt-in-by-default email switches — see App\Services\Mailer.
            'email_notifications' => 'boolean',
            'email_reminders' => 'boolean',
            'reminder_minutes' => 'integer',
        ];
    }

    /**
     * Does this account want emails about its bookings and payments?
     *
     * Accounts created before the preference existed have no value stored, and a
     * null must read as "yes" — silence because of a missing column would look
     * exactly like a broken mail server.
     */
    public function wantsBookingEmails(): bool
    {
        return $this->email_notifications === null ? true : (bool) $this->email_notifications;
    }

    /** …and the kick-off reminder? */
    public function wantsReminders(): bool
    {
        return $this->email_reminders === null ? true : (bool) $this->email_reminders;
    }

    /**
     * @return list<string>
     */
    protected function blankStringColumns(): array
    {
        return ['avatar_url'];
    }

    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class, 'user_id');
    }

    public function venues(): HasMany
    {
        return $this->hasMany(Venue::class, 'owner_id');
    }

    public function teamMemberships(): HasMany
    {
        return $this->hasMany(TeamMember::class, 'user_id');
    }
}
