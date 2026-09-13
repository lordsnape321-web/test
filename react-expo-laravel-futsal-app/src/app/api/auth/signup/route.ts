import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, safeUser } from "@/lib/auth";
import { validateName, validateEmail, validatePhone, validatePassword, normalizePhone, validateCity, validateAvatarUrl, firstError } from "@/lib/validation";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const AVATAR_COLORS = [
  "#16a34a",
  "#2563eb",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#be123c",
  "#4d7c0f",
];

const LEVELS = ["Beginner", "Intermediate", "Advanced"];
const POSITIONS = ["Striker", "Midfielder", "Winger", "Defender", "Goalkeeper", "Pivot", "All-rounder"];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const phone = normalizePhone(String(body.phone ?? ""));
    const password = String(body.password ?? "");
    const role = body.role === "owner" ? "owner" : "player";

    const defaultCity = String(body.defaultCity ?? "All Cities").trim();
    const avatarUrl = String(body.avatarUrl ?? "").trim();
    const err = firstError(
      validateName(name),
      validateEmail(email),
      validatePhone(phone, { required: true }),
      validatePassword(password),
      body.defaultCity !== undefined ? validateCity(defaultCity, "Home city") : null,
      avatarUrl ? validateAvatarUrl(avatarUrl) : null
    );
    if (err) return Response.json({ error: err }, { status: 400 });

    if (role !== "owner") {
      if (body.level && !LEVELS.includes(String(body.level)))
        return Response.json({ error: "Pick a valid level 🌱⚡🔥" }, { status: 400 });
      if (body.position && !POSITIONS.includes(String(body.position)))
        return Response.json({ error: "Pick a valid position ⚽" }, { status: 400 });
    }

    const emailTaken = await db.select().from(users).where(eq(users.email, email));
    if (emailTaken.length > 0) {
      return Response.json(
        { error: "This email is already registered. Please log in instead. 💌" },
        { status: 409 }
      );
    }

    const phoneTaken = await db.select().from(users).where(eq(users.phone, phone));
    if (phoneTaken.length > 0) {
      return Response.json(
        { error: "This phone number is already registered. Please log in instead. 📱" },
        { status: 409 }
      );
    }

    const inserted = await db
      .insert(users)
      .values({
        name,
        email,
        phone,
        passwordHash: hashPassword(password),
        role,
        avatarColor:
          AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
        avatarUrl: avatarUrl.slice(0, 2000000),
        defaultCity,
        level: role === "owner" ? "—" : String(body.level ?? "Intermediate"),
        position: role === "owner" ? "Owner" : String(body.position ?? "All-rounder"),
      })
      .returning();

    return Response.json({ user: safeUser(inserted[0]) }, { status: 201 });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
