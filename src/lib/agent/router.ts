import { Agent } from "@strands-agents/sdk";
import { db } from "@/lib/db";
import { DEFAULT_AGENT_SLUG } from "./slugs";
import { makeModel } from "./model";

const ROUTER_PROMPT = `You route a user's message to one agent. Reply with the agent slug only. No other words.
If no agent fits, reply with: ${DEFAULT_AGENT_SLUG}`;

/**
 * Pick the agent that should answer a message.
 * The model classifies the message from each agent's description. Any failure falls back to the default agent.
 * @param text the user's message
 * @return the slug of an existing agent
 */
export async function routeAgent(text: string): Promise<string> {
  const agents = await db.agent.findMany({ select: { slug: true, description: true } });
  const slugs = new Set(agents.map((a) => a.slug));
  const fallback = slugs.has(DEFAULT_AGENT_SLUG) ? DEFAULT_AGENT_SLUG : (agents[0]?.slug ?? DEFAULT_AGENT_SLUG);

  if (agents.length < 2) return fallback;

  try {
    const list = agents.map((a) => `- ${a.slug}: ${a.description || "no description"}`).join("\n");
    const router = new Agent({ name: "Router", model: makeModel(), systemPrompt: `${ROUTER_PROMPT}\n\nAgents:\n${list}`, printer: false });
    const result = await router.invoke(text);
    const answer = String(result).toLowerCase();
    // Take the first known slug the model mentioned. Thinking models may add words around it.
    return [...slugs].find((s) => answer.includes(s.toLowerCase())) ?? fallback;
  } catch {
    return fallback;
  }
}
