import { db } from "@/db";
import { users } from "@/db/schema";
import { safeUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    // ?q= narrows by name or email — the captain's invite search box.
    // No parameter returns everyone, exactly as before.
    const q = String(searchParams.get("q") ?? "").trim().toLowerCase();
    // ?role=player is the one list a squad is allowed to recruit from: venue
    // owners run courts and admins run the platform, so neither belongs in a
    // roster. Filtering here rather than in the component means a UI tweak cannot
    // quietly put staff accounts back in front of a captain.
    const role = String(searchParams.get("role") ?? "").trim().toLowerCase();
    let list = await db.select().from(users);
    if (q) {
      list = list.filter(
        (u) =>
          u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      );
    }
    if (role)
      list = list.filter((u) => String(u.role ?? "player").toLowerCase() === role);
    return Response.json({ users: list.map(safeUser), query: q, role });
  } catch (e) {
    console.error(`[/api/users GET] failed:`, e);
    return Response.json({ users: [], error: String(e) }, { status: 500 });
  }
}
