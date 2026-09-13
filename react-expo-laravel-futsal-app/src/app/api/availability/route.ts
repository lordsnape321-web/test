import { db } from "@/db";
import { bookings } from "@/db/schema";
import { expandBookingSlots } from "@/lib/futsal";
import { validateDateISO, firstError } from "@/lib/validation";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const courtId = Number(searchParams.get("courtId"));
    const date = searchParams.get("date") ?? "";
    if (!Number.isInteger(courtId) || courtId <= 0)
      return Response.json({ booked: [], error: "Pick a valid court ⚽" });
    const dateErr = firstError(validateDateISO(date, { label: "Date", maxDaysAhead: 90 }));
    if (dateErr) return Response.json({ booked: [], error: dateErr });

    const rows = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.courtId, courtId), eq(bookings.date, date)));

    const active = rows.filter((r) => r.status !== "cancelled" && r.status !== "rejected");
    const bookedSlots = Array.from(
      new Set(active.flatMap((r) => expandBookingSlots(r.startTime, r.durationHours ?? 1)))
    );
    return Response.json({ booked: bookedSlots, bookings: active });
  } catch (e) {
    console.error(`[/api/availability GET] failed:`, e);
    return Response.json({ booked: [], error: String(e) }, { status: 500 });
  }
}
