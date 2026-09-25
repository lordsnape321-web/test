import { db, ensureCompetitionBookingColumns } from "@/db";
import { vouchers, bookings, courts, venues } from "@/db/schema";
import { monthKey, LOYALTY_TARGET } from "@/lib/loyalty";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// GET /api/vouchers?userId=1 -> vouchers + per-venue monthly progress
export async function GET(req: Request) {
  try {
    await ensureCompetitionBookingColumns();
    const { searchParams } = new URL(req.url);
    const userId = Number(searchParams.get("userId"));
    if (!userId) return Response.json({ vouchers: [], progress: [] });
    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json({ vouchers: [], progress: [], error: "Invalid user 🎁" }, { status: 400 });

    const mine = await db.select().from(vouchers).where(eq(vouchers.userId, userId));
    const myBookings = await db.select().from(bookings).where(eq(bookings.userId, userId));
    const allCourts = await db.select().from(courts);
    const allVenues = await db.select().from(venues);

    const month = monthKey();
    // Count confirmed/completed paid games this month per venue.
    const counts = new Map<number, number>();
    for (const b of myBookings) {
      if (b.status !== "confirmed" && b.status !== "completed") continue;
      if (b.isFreePlay) continue;
      const c = allCourts.find((x) => x.id === b.courtId);
      if (!c) continue;
      try {
        const d = new Date((b.createdAt as Date) ?? new Date());
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (key !== month) continue;
      } catch {
        continue;
      }
      counts.set(c.venueId, (counts.get(c.venueId) ?? 0) + 1);
    }

    const progress = [...counts.entries()].map(([venueId, count]) => {
      const venue = allVenues.find((v) => v.id === venueId);
      return {
        venueId,
        venueName: venue?.name ?? "Futsal",
        venueImage: venue?.imageUrl ?? "",
        count,
        target: LOYALTY_TARGET,
        remaining: Math.max(0, LOYALTY_TARGET - count),
        done: count >= LOYALTY_TARGET,
      };
    });

    const enriched = mine
      .map((v) => ({
        ...v,
        venue: allVenues.find((x) => x.id === v.venueId) ?? null,
      }))
      .sort((a, b) => b.id - a.id);

    return Response.json({ vouchers: enriched, progress, month });
  } catch (e) {
    console.error(`[/api/vouchers GET] failed:`, e);
    return Response.json({ vouchers: [], progress: [], error: String(e) }, { status: 500 });
  }
}
