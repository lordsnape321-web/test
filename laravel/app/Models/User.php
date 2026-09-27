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
        ];
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
