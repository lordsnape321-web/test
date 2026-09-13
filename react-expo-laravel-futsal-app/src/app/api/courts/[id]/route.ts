import { db } from "@/db";
import { courts } from "@/db/schema";
import { validateCourtName, validateMoney, firstError } from "@/lib/validation";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const FORMATS = ["5v5", "6v6", "7v7", "8v8"];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!Number.isInteger(Number(id)) || Number(id) <= 0)
      return Response.json({ error: "Invalid court ⚽" }, { status: 400 });
    const body = await req.json();
    const err = firstError(
      body.name !== undefined ? validateCourtName(String(body.name)) : null,
      body.format !== undefined && !FORMATS.includes(String(body.format)) ? "Pick a valid format (5v5–8v8) ⚽" : null,
      body.surface !== undefined && String(body.surface).trim().length > 60 ? "Surface name too long (max 60)" : null,
      body.pricePerHour !== undefined ? validateMoney(body.pricePerHour, { min: 100, max: 20000, label: "Price per hour" }) : null,
      body.priceMorning !== undefined ? validateMoney(body.priceMorning, { min: 100, max: 20000, label: "Morning price" }) : null,
      body.features !== undefined && String(body.features).length > 500 ? "Facilities list too long (max 500)" : null
    );
    if (err) return Response.json({ error: err }, { status: 400 });
    const patch: Partial<typeof courts.$inferInsert> = {};
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.format !== undefined) patch.format = String(body.format);
    if (body.surface !== undefined) patch.surface = String(body.surface).slice(0, 60);
    if (body.pricePerHour !== undefined) patch.pricePerHour = Number(body.pricePerHour);
    if (body.priceMorning !== undefined) patch.priceMorning = Number(body.priceMorning);
    if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);
    if (body.features !== undefined) patch.features = String(body.features).slice(0, 500);
    if (body.imageUrl !== undefined) patch.imageUrl = String(body.imageUrl).slice(0, 2000000);

    const updated = await db
      .update(courts)
      .set(patch)
      .where(eq(courts.id, Number(id)))
      .returning();
    if (updated.length === 0)
      return Response.json({ error: "Court not found" }, { status: 404 });
    return Response.json({ court: updated[0] });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
