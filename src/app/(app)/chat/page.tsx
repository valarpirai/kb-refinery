import { ChatShell } from "@/components/chat-shell";
import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/session";
import "./chat.css";
import type { ConversationItem } from "./types";

export const dynamic = "force-dynamic";

/** Chat page. Loads only the sidebar list; the shell fetches the open conversation and status. */
export default async function ChatPage() {
  const user = await requirePageUser();

  const conversations = await db.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, title: true, updatedAt: true },
  });

  return (
    <ChatShell
      userName={user.name}
      isAdmin={user.role === "admin"}
      initialConversations={JSON.parse(JSON.stringify(conversations)) as ConversationItem[]}
    />
  );
}
