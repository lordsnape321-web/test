<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\SoftDeletes;
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
 *
 * Soft-deleted accounts are closed accounts: `App\Services\AccountDeletion`
 * scrubs the identity and sets `deleted_at`, and every ordinary query in the app
 * then stops seeing the row — nobody can log in as it, find it by email, or
 * invite it — while the bookings and payments that reference it stay intact.
 */
class User extends Authenticatable
{
    use CamelCasedAttributes;
    use HasFactory;
    use Notifiable;
    use SoftDeletes;

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
        'push_notifications',
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
            'push_notifications' => 'boolean',
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
     * …and the buzz on the phone?
     *
     * Same default as the email switches: on. A missing value means the column
     * arrived after this account did, and silence would look like a broken app
     * rather than a choice.
     */
    public function wantsPush(): bool
    {
        return $this->push_notifications === null ? true : (bool) $this->push_notifications;
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
