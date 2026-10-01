<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\BookingPaymentRequest;
use App\Models\Court;
use App\Models\MatchJoin;
use App\Models\Notification;
use App\Models\OpenMatch;
use App\Models\TeamInvite;
use App\Models\TeamMember;
use App\Models\TeamRequest;
use App\Models\User;
use App\Models\Venue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Closing an account.
 *
 * A hard `DELETE FROM users` is not possible and would be wrong anyway: bookings,
 * payments, ledger entries, teams and tournaments all reference the row (several
 * with `restrictOnDelete` foreign keys), and the other people on those bookings
 * still need their history to add up. What someone means by "delete my account"
 * is "stop having an account", so:
 *
 *   • the identity is erased — name, email, phone, password, photo, city,
 *     level, position, email preferences;
 *   • the row is soft-deleted, so every query in the app stops seeing it: no
 *     login, no lookup by email, no invitations, no player lists;
 *   • the things that were *waiting on them* are withdrawn: pending booking
 *     requests are cancelled (a venue should not hold a slot for a closed
 *     account), open spots they were holding in somebody's game are released,
 *     and their team memberships, requests and open invitations go;
 *   • the things that are other people's history — confirmed bookings, settled
 *     payments, match results — stay, attributed to a nameless account.
 *
 * Email is replaced rather than blanked because the column is unique and the
 * address must become available again for a new signup.
 */
class AccountDeletion
{
    /** The name the history keeps. Honest, and it leaks nothing. */
    public const CLOSED_NAME = 'Deleted player';

    /**
     * Close the account. Returns false when there is nothing to close.
     */
    public static function close(User $user): bool
    {
        if ($user->trashed()) {
            return false;
        }

        return DB::transaction(function () use ($user): bool {
            $id = (int) $user->id;

            self::withdrawPendingBookings($id);
            self::withdrawPaymentRequests($id);
            self::releaseGameSpots($id);
            self::leaveTeams($id);
            self::clearNotifications($id);
            self::retireVenues($id);

            $user->forceFill([
                'name' => self::CLOSED_NAME,
                // Kept unique and non-deliverable: the original address must be
                // free for a new account, and nothing may ever be sent here.
                'email' => 'closed-'.$id.'@deleted.futsal.invalid',
                'phone' => '',
                'password_hash' => '',
                'avatar_url' => null,
                'default_city' => 'All Cities',
                'email_notifications' => false,
                'email_reminders' => false,
                'deleted_at' => now(),
            ])->save();

            Log::info('Account closed', ['user_id' => $id]);

            return true;
        });
    }

    /**
     * Pending booking requests are cancelled; anything already accepted,
     * completed or paid for is left alone, because a venue's ledger and the
     * other players' history depend on it.
     */
    private static function withdrawPendingBookings(int $userId): void
    {
        Booking::where('user_id', $userId)
            ->where('status', 'pending')
            ->update(['status' => 'cancelled', 'advance_payment_status' => 'cancelled']);
    }

    /**
     * "Ask to pay" requests addressed to this player are withdrawn: nobody can
     * settle a share on an account that no longer exists, and leaving them
     * pending would keep a teammate waiting for money that is not coming.
     */
    private static function withdrawPaymentRequests(int $userId): void
    {
        BookingPaymentRequest::where('payer_id', $userId)
            ->where('status', 'pending')
            ->update(['status' => 'cancelled']);
    }

    /**
     * A closed account cannot turn up to a game, so it stops holding a place in
     * one: pending join requests are withdrawn, accepted ones are cancelled.
     */
    private static function releaseGameSpots(int $userId): void
    {
        MatchJoin::where('user_id', $userId)
            ->whereIn('status', ['pending', 'accepted'])
            ->update(['status' => 'cancelled']);

        // Games they were hosting belong to nobody now; leaving them open would
        // advertise a kick-off with no organiser.
        OpenMatch::where('organizer_id', $userId)
            ->where('status', 'open')
            ->update(['status' => 'cancelled']);
    }

    private static function leaveTeams(int $userId): void
    {
        TeamMember::where('user_id', $userId)->delete();
        TeamRequest::where('user_id', $userId)->delete();
        TeamInvite::where('user_id', $userId)->delete();
    }

    private static function clearNotifications(int $userId): void
    {
        Notification::where('user_id', $userId)->delete();
    }

    /**
     * The venues this account runs.
     *
     * Closing an owner's account must not leave a ground advertised with nobody
     * on the desk, so each one is retired the same way the My Venues screen
     * retires it: the courts go dark, requests still waiting on that desk are
     * withdrawn, and the venue leaves every listing. Bookings already confirmed
     * or played stay on record — the players' history and the ledger still add
     * up, they just point at a retired ground.
     */
    private static function retireVenues(int $userId): void
    {
        foreach (Venue::where('owner_id', $userId)->get() as $venue) {
            $courtIds = Court::where('venue_id', $venue->id)->pluck('id')->all();

            if ($courtIds !== []) {
                Court::whereIn('id', $courtIds)->update(['is_active' => false]);

                Booking::whereIn('court_id', $courtIds)
                    ->where('status', 'pending')
                    ->update(['status' => 'cancelled', 'advance_payment_status' => 'cancelled']);
            }

            $venue->forceFill(['deleted_at' => now()])->save();
        }
    }
}
