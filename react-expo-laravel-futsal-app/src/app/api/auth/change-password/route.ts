import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { validatePassword, firstError } from "@/lib/validation";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userId = Number(body.userId);
    const currentPassword = String(body.currentPassword ?? "");
    const newPassword = String(body.newPassword ?? "");

    if (!userId || !Number.isInteger(userId) || userId <= 0)
      return Response.json({ error: "Valid login required 🔒" }, { status: 400 });
    const err = firstError(
      !currentPassword ? "Current password is required 🔒" : null,
      validatePassword(newPassword, { label: "New password" })
    );
    if (err) return Response.json({ error: err }, { status: 400 });
    if (currentPassword === newPassword)
      return Response.json({ error: "New password must be different from the old one 🔄" }, { status: 400 });

    const rows = await db.select().from(users).where(eq(users.id, userId));
    const account = rows[0];
    if (!account) return Response.json({ error: "User not found" }, { status: 404 });
    if (!verifyPassword(currentPassword, account.passwordHash)) {
      return Response.json({ error: "Current password is incorrect 🔒" }, { status: 401 });
    }

    await db
      .update(users)
      .set({ passwordHash: hashPassword(newPassword) })
      .where(eq(users.id, userId));

    return Response.json({ ok: true });
  } catch (e) {
    console.error(`[/api/auth/change-password POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
