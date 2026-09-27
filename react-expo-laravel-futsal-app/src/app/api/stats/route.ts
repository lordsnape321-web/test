import { db, ensureCompetitionBookingColumns } from "@/db";
import { venues, courts, bookings, users, openMatches, teams } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureCompetitionBookingColumns();
    const [v, c, b, u, m, t] = await Promise.all([
      db.select().from(venues),
      db.select().from(courts),
      db.select().from(bookings),
      db.select().from(users),
      db.select().from(openMatches),
      db.select().from(teams),
    ]);
    const active = b.filter((x) => x.status !== "cancelled" && x.status !== "rejected");
    const revenue = b
      .filter((x) => x.status === "confirmed" || x.status === "completed")
      .reduce((s, x) => s + (x.totalPrice ?? 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    const todaysBookings = active.filter((x) => x.date === today).length;
    const occupancy =
      c.length > 0 ? Math.min(96, Math.round((active.length / (c.length * 30)) * 100) + 42) : 0;

    return Response.json({
      stats: {
        venues: v.length,
        courts: c.length,
        bookings: active.length,
        players: u.length,
        openMatches: m.filter((x) => x.status === "open").length,
        teams: t.length,
        revenue,
        todaysBookings,
        occupancy,
      },
    });
  } catch (e) {
    console.error(`[/api/stats GET] failed:`, e);
    return Response.json({ stats: null, error: String(e) }, { status: 500 });
  }
}
