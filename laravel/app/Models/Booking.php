<?php

namespace App\Models;

use App\Models\Concerns\CamelCasedAttributes;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A court booking — the record every rupee hangs off.
 *
 * Money columns on the row (paid_amount, deposit_amount, …) are mirrors for
 * quick listing. The truth lives in the ledger (booking_payments +
 * booking_extras) and is recomputed by App\Support\BookingLedger, exactly as it
 * was in the Next.js API: a booking paid as 700 eSewa + 500 Khalti + 500 cash is
 * three traceable rows, never one "paid" flag.
 */
class Booking extends Model
{
    use CamelCasedAttributes;
    use HasFactory;

    /**
     * @var list<string>
     */
    protected $fillable = [
        'court_id', 'user_id', 'date', 'start_time', 'end_time', 'duration_hours',
        'total_price', 'status', 'payment_status', 'payment_method', 'booker_name',
        'booker_phone', 'notes', 'visibility', 'players_needed', 'our_crew', 'open_spots',
        'team_id', 'team_name', 'receipt_url', 'is_free_play', 'voucher_id', 'promo_id',
        'promo_code', 'price_before_discount', 'discount_amount', 'tournament_id',
        'opponent_team_id', 'home_score', 'away_score', 'score_status', 'competition_status',
        'competition_responded_by', 'competition_responded_at', 'score_updated_by',
        'score_updated_at', 'competition_payment_policy', 'charge_mode', 'custom_price_per_player',
        'deposit_required', 'deposit_amount', 'deposit_status', 'esewa_uuid', 'khalti_pidx',
        'gateway_txn_id', 'paid_amount', 'settled_at', 'settled_by', 'advance_payment_required',
        'advance_payment_amount', 'advance_payment_status', 'advance_payment_requested_by',
        'advance_payment_requested_at', 'cancellation_money_status', 'cancellation_received_amount',
        'cancellation_refunded_amount', 'cancellation_money_resolved_at', 'cancellation_money_resolved_by',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'duration_hours' => 'float',
            'total_price' => 'integer',
            'players_needed' => 'integer',
            'our_crew' => 'integer',
            'open_spots' => 'integer',
            'is_free_play' => 'boolean',
            'price_before_discount' => 'integer',
            'discount_amount' => 'integer',
            'home_score' => 'integer',
            'away_score' => 'integer',
            'custom_price_per_player' => 'integer',
            'deposit_required' => 'boolean',
            'deposit_amount' => 'integer',
            'paid_amount' => 'integer',
            'advance_payment_required' => 'boolean',
            'advance_payment_amount' => 'integer',
            'cancellation_received_amount' => 'integer',
            'cancellation_refunded_amount' => 'integer',
            'settled_at' => 'datetime',
            'score_updated_at' => 'datetime',
            'competition_responded_at' => 'datetime',
            'advance_payment_requested_at' => 'datetime',
            'cancellation_money_resolved_at' => 'datetime',
        ];
    }

    /**
     * @return list<string>
     */
    protected function blankStringColumns(): array
    {
        return ['notes', 'receipt_url', 'team_name', 'promo_code'];
    }

    public function court(): BelongsTo
    {
        return $this->belongsTo(Court::class, 'court_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function payments(): HasMany
    {
        return $this->hasMany(BookingPayment::class, 'booking_id');
    }

    public function extras(): HasMany
    {
        return $this->hasMany(BookingExtra::class, 'booking_id');
    }

    public function teamPayments(): HasMany
    {
        return $this->hasMany(BookingTeamPayment::class, 'booking_id');
    }

    public function paymentRequests(): HasMany
    {
        return $this->hasMany(BookingPaymentRequest::class, 'booking_id');
    }
}
