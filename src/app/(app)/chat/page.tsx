import { ChatShell } from "@/components/chat-shell";
import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/session";
import "./chat.css";
import type { ConversationData, ConversationItem, Tally } from "./types";

export const dynamic = "force-dynamic";

/** Chat page. Loads only the signed-in user's conversations and verdicts. */
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const user = await requirePageUser();
  const { c } = await searchParams;

  const [conversations, selected, verdicts, indexedArticles, analyzed] = await Promise.all([
    db.conversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: { id: true, title: true, updatedAt: true },
    }),
    c
      ? db.conversation.findFirst({
          where: { id: c, userId: user.id },
          include: {
            comparisons: { orderBy: { createdAt: "asc" }, include: { arms: true } },
            messages: { orderBy: { createdAt: "asc" } },
          },
        })
      : null,
    db.comparison.groupBy({ by: ["verdict"], where: { conversation: { userId: user.id } }, _count: true }),
    db.chunk.findMany({ distinct: ["articleId"], select: { articleId: true } }),
    db.analysis.count({ where: { pipelineStage: "ready" } }),
  ]);

  const tally: Tally = { original: 0, refined: 0, tie: 0, neither: 0 };
  verdicts.forEach((v) => {
    if (v.verdict) tally[v.verdict] = v._count;
  });

  return (
    <ChatShell
      userName={user.name}
      isAdmin={user.role === "admin"}
      initialConversations={JSON.parse(JSON.stringify(conversations)) as ConversationItem[]}
      initialActive={selected ? (JSON.parse(JSON.stringify(selected)) as ConversationData) : null}
      initialTally={tally}
      index={{ indexed: indexedArticles.length, total: analyzed }}
    />
  );
}
