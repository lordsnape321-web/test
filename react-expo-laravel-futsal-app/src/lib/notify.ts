import { db } from "@/db";
import { notifications } from "@/db/schema";

export async function sendNotification(input: {
  userId: number;
  type: string;
  title: string;
  message?: string;
  link?: string;
}) {
  if (!input.userId) return null;
  try {
    const rows = await db
      .insert(notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message ?? "",
        link: input.link ?? "",
        isRead: false,
      })
      .returning();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
