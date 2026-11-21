import { db } from "@/lib/db";
import { AUTO_AGENT_SLUG, DEFAULT_AGENT_SLUG } from "@/lib/agent/slugs";
import { AGENT_QUEUE, getBoss } from "@/lib/queue";

export { DEFAULT_AGENT_SLUG };

/**
 * Add a user message to an agent conversation, create the pending reply, and queue the agent.
 * Starts a new conversation when none is given.
 * @param userId the owner
 * @param text what the user said
 * @param opts.conversationId an existing conversation of this user. It keeps the agent it started with.
 * @param opts.agentSlug the agent for a new conversation; defaults to the refinery agent. "auto" lets the router pick for each message.
 * @param opts.title title for a new conversation
 * @return ids the page needs to show and poll the reply
 */
export async function startAgentTurn(userId: string, text: string, opts: { conversationId?: string; title?: string; agentSlug?: string } = {}) {
  let conversationId = opts.conversationId;
  if (conversationId) {
    const found = await db.conversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } });
    if (!found) throw new Error("Conversation not found");
  } else {
    const agentSlug = opts.agentSlug ?? DEFAULT_AGENT_SLUG;
    if (agentSlug !== AUTO_AGENT_SLUG && !(await db.agent.findUnique({ where: { slug: agentSlug }, select: { id: true } }))) throw new Error("Agent not found");
    const title = opts.title ?? (text.length > 60 ? `${text.slice(0, 57)}…` : text);
    conversationId = (await db.conversation.create({ data: { userId, title, agentSlug } })).id;
  }
  const userMessage = await db.chatMessage.create({ data: { conversationId, role: "user", content: text, status: "completed" } });
  const assistant = await db.chatMessage.create({ data: { conversationId, role: "assistant", status: "pending" } });
  await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  await (await getBoss()).send(AGENT_QUEUE, { assistantId: assistant.id });
  return { conversationId, userMessageId: userMessage.id, assistantMessageId: assistant.id };
}
