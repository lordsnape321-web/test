import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { validateEmail, validatePhone, validatePassword, normalizePhone, firstError } from "@/lib/validation";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const phone = normalizePhone(String(body.phone ?? ""));
    const newPassword = String(body.newPassword ?? "");

    const err = firstError(
      validateEmail(email),
      validatePhone(phone, { required: true }),
      validatePassword(newPassword, { label: "New password" })
    );
    if (err) return Response.json({ error: err }, { status: 400 });

    const rows = await db.select().from(users).where(eq(users.email, email));
    const account = rows[0];
    if (!account) {
      return Response.json(
        { error: "No account found with this email. 🌱" },
        { status: 404 }
      );
    }
    if (account.phone !== phone) {
      return Response.json(
        { error: "That phone number doesn't match this account. 📱" },
        { status: 401 }
      );
    }

    await db
      .update(users)
      .set({ passwordHash: hashPassword(newPassword) })
      .where(eq(users.id, account.id));

    return Response.json({ ok: true });
  } catch (e) {
    console.error(`[/api/auth/reset POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
