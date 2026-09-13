import { db } from "@/db";
import { users } from "@/db/schema";
import { safeUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    // ?q= narrows by name or email — the captain's "add a member" search box.
    // No parameter returns everyone, exactly as before.
    const q = String(new URL(req.url).searchParams.get("q") ?? "")
      .trim()
      .toLowerCase();
    let list = await db.select().from(users);
    if (q) {
      list = list.filter(
        (u) =>
          u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      );
    }
    return Response.json({ users: list.map(safeUser), query: q });
  } catch (e) {
    console.error(`[/api/users GET] failed:`, e);
    return Response.json({ users: [], error: String(e) }, { status: 500 });
  }
}
