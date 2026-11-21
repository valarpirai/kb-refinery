import { db } from "@/lib/db";

export interface NotifyInput {
  level?: "info" | "success" | "warning" | "error";
  title: string;
  body?: string;
  href?: string;
}

/**
 * Leave a notification for one user. It appears in the bell and as a toast.
 * Never throws: a failed notification must not break the work that triggered it.
 * @param userId who to tell. Does nothing when there is no user.
 * @param n the message
 */
export async function notify(userId: string | null | undefined, n: NotifyInput): Promise<void> {
  if (!userId) return;
  try {
    await db.notification.create({ data: { userId, level: n.level ?? "info", title: n.title.slice(0, 200), body: n.body?.slice(0, 1000), href: n.href } });
  } catch (e) {
    console.warn("[notify]", (e as Error).message);
  }
}
