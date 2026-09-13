import { db } from "@/db";
import { users } from "@/db/schema";
import { safeUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const list = await db.select().from(users);
    return Response.json({ users: list.map(safeUser) });
  } catch (e) {
    return Response.json({ users: [], error: String(e) }, { status: 500 });
  }
}
