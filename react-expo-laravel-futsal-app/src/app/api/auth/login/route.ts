import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, verifyPassword, safeUser } from "@/lib/auth";
import { validateEmail, firstError } from "@/lib/validation";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    const err = firstError(
      validateEmail(email),
      !password ? "Password is required 🔒" : password.length > 100 ? "Password is too long" : null
    );
    if (err) return Response.json({ error: err }, { status: 400 });

    const rows = await db.select().from(users).where(eq(users.email, email));
    const account = rows[0];
    if (!account) {
      return Response.json(
        { error: "No account found with this email. Please sign up. 🌱" },
        { status: 404 }
      );
    }

    if (!account.passwordHash) {
      const healed = await db
        .update(users)
        .set({ passwordHash: hashPassword(password) })
        .where(eq(users.id, account.id))
        .returning();
      return Response.json({ user: safeUser(healed[0]) });
    }

    if (!verifyPassword(password, account.passwordHash)) {
      return Response.json({ error: "Incorrect password. Try again — or reset it! 🔑" }, { status: 401 });
    }

    return Response.json({ user: safeUser(account) });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
