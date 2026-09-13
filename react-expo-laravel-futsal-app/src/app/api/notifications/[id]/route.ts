import { db } from "@/db";
import { notifications } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const updated = await db
      .update(notifications)
      .set({ isRead: body.isRead === undefined ? true : Boolean(body.isRead) })
      .where(eq(notifications.id, Number(id)))
      .returning();
    return Response.json({ notification: updated[0] ?? null });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(notifications).where(eq(notifications.id, Number(id)));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
