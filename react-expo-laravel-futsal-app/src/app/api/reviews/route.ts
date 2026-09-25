import { db, ensureCompetitionBookingColumns } from "@/db";
import { reviews, users, venues, bookings, courts } from "@/db/schema";
import { sendNotification } from "@/lib/notify";
import { validateMessage, firstError } from "@/lib/validation";
import { gamePlayed } from "@/lib/futsal";
import { eq, desc, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureCompetitionBookingColumns();
    const { searchParams } = new URL(req.url);
    const venueId = searchParams.get("venueId");
    const userId = searchParams.get("userId");

    let rows = await db.select().from(reviews).orderBy(desc(reviews.createdAt));
    if (venueId) rows = rows.filter((r) => r.venueId === Number(venueId));
    if (userId) rows = rows.filter((r) => r.userId === Number(userId));

    const allUsers = await db.select().from(users);
    const enriched = rows.map((r) => {
      const u = allUsers.find((x) => x.id === r.userId);
      return {
        ...r,
        userName: u?.name ?? "Player",
        avatarColor: u?.avatarColor ?? "#22c55e",
        avatarUrl: (u as { avatarUrl?: string } | undefined)?.avatarUrl ?? "",
        userLevel: u?.level ?? "",
      };
    });
    return Response.json({ reviews: enriched });
  } catch (e) {
    console.error(`[/api/reviews GET] failed:`, e);
    return Response.json({ reviews: [], error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureCompetitionBookingColumns();
    const body = await req.json();
    const venueId = Number(body.venueId);
    const userId = Number(body.userId);
    const bookingId = body.bookingId ? Number(body.bookingId) : null;
    const ratingRaw = Number(body.rating ?? 5);
    const message = String(body.message ?? "").trim();

    const err = firstError(
      !Number.isInteger(venueId) || venueId <= 0 ? "Pick a valid venue 📍" : null,
      !Number.isInteger(userId) || userId <= 0 ? "Login to post a review 🔒" : null,
      !Number.isInteger(ratingRaw) || ratingRaw < 1 || ratingRaw > 5 ? "Tap 1–5 stars ⭐" : null,
      validateMessage(message, { min: 3, max: 1000, label: "Review" })
    );
    if (err) return Response.json({ error: err }, { status: 400 });
    const rating = ratingRaw;

    // Eligibility: must have actually played here (confirmed/completed booking in the past,
    // or a completed game).
    const myBookings = await db.select().from(bookings).where(eq(bookings.userId, userId));
    const allCourts = await db.select().from(courts);
    const playedHere = myBookings.filter((b) => {
      const c = allCourts.find((x) => x.id === b.courtId);
      if (!c || c.venueId !== venueId) return false;
      return gamePlayed(b);
    });
    if (playedHere.length === 0) {
      return Response.json(
        { error: "Play a game here first — reviews unlock after you've played! ⚽" },
        { status: 403 }
      );
    }

    if (bookingId) {
      // The game named must be one of the ones actually played here.
      if (!playedHere.some((b) => b.id === bookingId)) {
        return Response.json({ error: "That game isn't reviewable yet." }, { status: 403 });
      }
    }

    /*
     * One review per player per venue 🎯
     *
     * However many games someone plays here, their voice shows up once. The
     * first review inserts; every later one *updates* that same row — rating,
     * message and the game it was written from — so the venue page never ends
     * up with an old and a new review from the same player. Playing another
     * game here is what reopens the review; it never adds a second one.
     */
    const existing = (
      await db
        .select()
        .from(reviews)
        .where(and(eq(reviews.userId, userId), eq(reviews.venueId, venueId)))
    )[0];

    const saved = existing
      ? (
          await db
            .update(reviews)
            .set({
              rating,
              message,
              // Keep pointing at the game the review came from when the player
              // didn't pick one this time.
              bookingId: bookingId ?? existing.bookingId,
              updatedAt: new Date(),
            })
            .where(eq(reviews.id, existing.id))
            .returning()
        )[0]
      : (
          await db
            .insert(reviews)
            .values({ venueId, userId, bookingId, rating, message })
            .returning()
        )[0];

    // Refresh venue average rating.
    const venueRows = await db.select().from(venues).where(eq(venues.id, venueId));
    const venue = venueRows[0];
    if (venue) {
      const all = await db.select().from(reviews).where(eq(reviews.venueId, venueId));
      const avg = all.reduce((s, r) => s + r.rating, 0) / Math.max(1, all.length);
      await db
        .update(venues)
        .set({
          rating: Math.round(avg * 10) / 10,
          totalReviews: all.length,
        })
        .where(eq(venues.id, venueId));
      // Let the owner know — worded differently for a fresh review vs an update.
      if (venue.ownerId) {
        const author = await db.select().from(users).where(eq(users.id, userId));
        const who = author[0]?.name ?? "A player";
        await sendNotification({
          userId: venue.ownerId,
          type: "review",
          title: existing
            ? `⭐ ${who} updated their review — ${venue.name}`
            : `⭐ New ${rating}-star review — ${venue.name}`,
          message: `${who} says: "${message.slice(0, 120)}${message.length > 120 ? "…" : ""}"`,
          link: "/admin/venues",
        });
      }
    }

    return Response.json({ review: saved, updated: !!existing }, { status: existing ? 200 : 201 });
  } catch (e) {
    console.error(`[/api/reviews POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * Reviews are locked once written 🔒
 *
 * A player gets one review per venue and keeps it: it can be *updated* (POST
 * again after playing another game there) but not removed, so a venue's rating
 * can't be scrubbed by deleting the bad ones. The endpoint stays so old clients
 * get a clear answer instead of a 405.
 */
export async function DELETE(_req: Request) {
  return Response.json(
    {
      error:
        "Reviews are locked 🔒 — you can't delete one, but you can update it after your next game here.",
    },
    { status: 403 }
  );
}
