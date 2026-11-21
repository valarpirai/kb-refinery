import { Agent } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { buildTools } from "./tools";

const FLUSH_MS = 400;
const HISTORY_LIMIT = 12;
const MAX_TOOL_OUTPUT = 2000;

type ToolCall = {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  status: "running" | "success" | "error";
  startedAt: string;
  endedAt?: string;
};

type ToolResultShape = { toolUseId: string; status: string; content?: { text?: string }[] };

type StreamEvent = {
  type: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
  toolUse?: { name: string; toolUseId: string; input: unknown };
  // The live object has these fields directly; its JSON form wraps them in `toolResult`.
  result?: ToolResultShape & { toolResult?: ToolResultShape };
};

/** The model, pointed at Ollama's OpenAI-compatible endpoint. */
function makeModel() {
  return new OpenAIModel({
    api: "chat",
    modelId: process.env.OLLAMA_MODEL ?? "qwen3:4b-thinking-2507-q4_K_M",
    apiKey: "ollama",
    clientConfig: { baseURL: `${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}/v1` },
  });
}

/**
 * Run the agent for one assistant message and stream its progress into the database.
 * The page polls the message, so text and tool calls appear as they happen.
 * A failure is recorded on the message, not thrown.
 * @param assistantId the pending assistant ChatMessage to fill in
 */
export async function runAgentMessage(assistantId: string): Promise<void> {
  const message = await db.chatMessage.findUnique({ where: { id: assistantId }, include: { conversation: true } });
  if (!message || message.role !== "assistant") return;

  const prior = await db.chatMessage.findMany({
    where: { conversationId: message.conversationId, createdAt: { lt: message.createdAt }, status: "completed" },
    orderBy: { createdAt: "asc" },
  });
  const last = prior[prior.length - 1];
  if (!last || last.role !== "user") {
    await db.chatMessage.update({ where: { id: assistantId }, data: { status: "failed", error: "No question to answer" } });
    return;
  }
  const history = prior.slice(0, -1).slice(-HISTORY_LIMIT).map((m) => ({
    role: m.role as "user" | "assistant",
    content: [{ text: m.content }],
  }));

  await trace.getTracer("kb-refinery").startActiveSpan("kb_refinery.agent_chat", async (span) => {
    span.setAttribute("kb.conversation_id", message.conversationId);
    span.setAttribute("kb.message_id", assistantId);
    await db.chatMessage.update({ where: { id: assistantId }, data: { status: "streaming", traceId: span.spanContext().traceId } });

    let text = "";
    const calls: ToolCall[] = [];
    let lastFlush = 0;
    const flush = async (force = false) => {
      if (!force && Date.now() - lastFlush < FLUSH_MS) return;
      lastFlush = Date.now();
      await db.chatMessage.update({ where: { id: assistantId }, data: { content: text, toolCalls: calls as unknown as Prisma.InputJsonValue } });
    };

    try {
      // Read the agent on every run, so a saved edit applies to the next message. The prompt was built when it was saved.
      const slug = message.conversation.agentSlug;
      const config = await db.agent.findUnique({ where: { slug } });
      if (!config) throw new Error(`Agent "${slug}" does not exist. Pick another agent or run pnpm db:seed.`);
      if (!config.prompt.trim()) throw new Error(`Agent "${slug}" has no prompt yet. Open it on the Agents page and save.`);
      const agent = new Agent({
        model: makeModel(),
        tools: buildTools({ userId: message.conversation.userId }, config.tools),
        systemPrompt: config.prompt,
        messages: history,
        printer: false,
      });
      for await (const raw of agent.stream(last.content)) {
        const ev = raw as unknown as StreamEvent;
        if (ev.type === "modelStreamUpdateEvent" && ev.event?.delta?.type === "textDelta" && ev.event.delta.text) {
          text += ev.event.delta.text;
          await flush();
        } else if (ev.type === "beforeToolCallEvent" && ev.toolUse) {
          calls.push({ id: ev.toolUse.toolUseId, name: ev.toolUse.name, input: ev.toolUse.input, status: "running", startedAt: new Date().toISOString() });
          await flush(true);
        } else if (ev.type === "toolResultEvent" && ev.result) {
          const res = ev.result.toolResult ?? ev.result;
          const call = calls.find((c) => c.id === res.toolUseId);
          if (call) {
            call.status = res.status === "success" ? "success" : "error";
            call.output = (res.content?.map((c) => c.text ?? "").join("") ?? "").slice(0, MAX_TOOL_OUTPUT);
            call.endedAt = new Date().toISOString();
            await flush(true);
          }
        }
      }
      await db.chatMessage.update({
        where: { id: assistantId },
        data: { content: text.trim() || "I could not put together an answer. Try asking again.", toolCalls: calls as unknown as Prisma.InputJsonValue, status: "completed" },
      });
      await db.conversation.update({ where: { id: message.conversationId }, data: { updatedAt: new Date() } });
    } catch (e) {
      const msg = (e as Error).message.slice(0, 500);
      span.setStatus({ code: SpanStatusCode.ERROR, message: msg });
      await db.chatMessage.update({
        where: { id: assistantId },
        data: { status: "failed", error: msg, content: text, toolCalls: calls as unknown as Prisma.InputJsonValue },
      });
    } finally {
      span.end();
    }
  });
}
