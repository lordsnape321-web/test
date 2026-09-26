<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Venue extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    /**
     * @var list<string>
     */
    protected $fillable = [
        'name',
        'address',
        'city',
        'phone',
        'description',
        'image_url',
        'rating',
        'total_reviews',
        'opening_hour',
        'closing_hour',
        'amenities',
        'is_featured',
        'accepted_payments',
        'deposit_percent',
        'default_extra_fee',
        'default_extra_fee_note',
        'owner_id',
        'deleted_at',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'rating' => 'float',
            'total_reviews' => 'integer',
            'opening_hour' => 'integer',
            'closing_hour' => 'integer',
            'deposit_percent' => 'integer',
            'default_extra_fee' => 'integer',
            'is_featured' => 'boolean',
            'owner_id' => 'integer',
            'deleted_at' => 'datetime',
        ];
    }

    /**
     * @return list<string>
     */
    protected function blankStringColumns(): array
    {
        return ['description', 'image_url', 'default_extra_fee_note'];
    }

    public function courts(): HasMany
    {
        return $this->hasMany(Court::class, 'venue_id');
    }
}
