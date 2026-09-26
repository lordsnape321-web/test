<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * Match photos and videos: `file` is a photo the host picked (a data URL),
 * `link` points at an album they already keep.
 */
class TournamentMedia extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    protected $table = 'tournament_media';

    /**
     * @var list<string>
     */
    protected $fillable = ['tournament_id', 'match_id', 'kind', 'url', 'caption', 'credit', 'uploaded_by'];
}
