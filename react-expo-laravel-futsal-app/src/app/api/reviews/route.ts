import { db } from "@/db";
import { reviews, users, venues, bookings, courts } from "@/db/schema";
import { sendNotification } from "@/lib/notify";
import { validateMessage, firstError } from "@/lib/validation";
import { eq, desc, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
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
    return Response.json({ reviews: [], error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
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
    // or a completed game). One review per booking.
    const myBookings = await db.select().from(bookings).where(eq(bookings.userId, userId));
    const allCourts = await db.select().from(courts);
    const today = new Date().toISOString().slice(0, 10);
    const playedHere = myBookings.filter((b) => {
      const c = allCourts.find((x) => x.id === b.courtId);
      if (!c || c.venueId !== venueId) return false;
      if (b.status === "completed") return true;
      if (b.status === "confirmed" && b.date < today) return true;
      if (b.status === "confirmed" && b.date === today) {
        // Same-day: allow if the game already ended.
        try {
          const now = new Date();
          const end = new Date(`${b.date}T${b.endTime || b.startTime}:00`);
          return now > end;
        } catch {
          return false;
        }
      }
      return false;
    });
    if (playedHere.length === 0) {
      return Response.json(
        { error: "Play a game here first — reviews unlock after you've played! ⚽" },
        { status: 403 }
      );
    }

    if (bookingId) {
      const dup = await db
        .select()
        .from(reviews)
        .where(and(eq(reviews.bookingId, bookingId), eq(reviews.userId, userId)));
      if (dup.length > 0) {
        return Response.json({ error: "You already reviewed that game! 💚" }, { status: 409 });
      }
      const target = myBookings.find((b) => b.id === bookingId);
      if (!target || !playedHere.some((b) => b.id === bookingId)) {
        return Response.json({ error: "That game isn't reviewable yet." }, { status: 403 });
      }
    }

    const inserted = await db
      .insert(reviews)
      .values({ venueId, userId, bookingId, rating, message })
      .returning();

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
      // Let the owner know.
      if (venue.ownerId) {
        const author = await db.select().from(users).where(eq(users.id, userId));
        await sendNotification({
          userId: venue.ownerId,
          type: "review",
          title: `⭐ New ${rating}-star review — ${venue.name}`,
          message: `${author[0]?.name ?? "A player"} says: "${message.slice(0, 120)}${message.length > 120 ? "…" : ""}"`,
          link: "/admin/venues",
        });
      }
    }

    return Response.json({ review: inserted[0] }, { status: 201 });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    const userId = Number(searchParams.get("userId"));
    if (!id || !userId) return Response.json({ error: "id and userId required" }, { status: 400 });
    const rows = await db.select().from(reviews).where(eq(reviews.id, id));
    const r = rows[0];
    if (!r) return Response.json({ error: "Not found" }, { status: 404 });
    if (r.userId !== userId) {
      return Response.json({ error: "You can only delete your own review." }, { status: 403 });
    }
    await db.delete(reviews).where(eq(reviews.id, id));
    // Refresh venue average.
    const all = await db.select().from(reviews).where(eq(reviews.venueId, r.venueId));
    const avg = all.length > 0 ? all.reduce((s, x) => s + x.rating, 0) / all.length : 4.5;
    await db
      .update(venues)
      .set({ rating: Math.round(avg * 10) / 10, totalReviews: all.length })
      .where(eq(venues.id, r.venueId));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
