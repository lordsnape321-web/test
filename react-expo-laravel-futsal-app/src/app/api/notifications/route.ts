import { db } from "@/db";
import { notifications } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const VALID_TYPES = ["info", "booking_request", "booking_confirmed", "booking_rejected", "booking_cancelled", "payment", "match_join", "free_play", "review"];

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = Number(searchParams.get("userId"));
    if (!userId) return Response.json({ notifications: [], unread: 0 });
    if (!Number.isInteger(userId) || userId <= 0)
      return Response.json({ notifications: [], unread: 0, error: "Invalid user 🔔" }, { status: 400 });
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(100);
    const unread = rows.filter((r) => !r.isRead).length;
    return Response.json({ notifications: rows, unread });
  } catch (e) {
    return Response.json({ notifications: [], unread: 0, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userId = Number(body.userId);
    const title = String(body.title ?? "").trim();
    if (!Number.isInteger(userId) || userId <= 0 || !title) {
      return Response.json({ error: "userId and title required 🔔" }, { status: 400 });
    }
    if (title.length > 200) return Response.json({ error: "Title too long (max 200) 🔔" }, { status: 400 });
    const type = String(body.type ?? "info");
    if (!VALID_TYPES.includes(type)) return Response.json({ error: "Invalid notification type 🔔" }, { status: 400 });
    const rows = await db
      .insert(notifications)
      .values({
        userId,
        type,
        title: title.slice(0, 200),
        message: String(body.message ?? "").slice(0, 1000),
        link: String(body.link ?? "").slice(0, 300),
        isRead: false,
      })
      .returning();
    return Response.json({ notification: rows[0] }, { status: 201 });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
