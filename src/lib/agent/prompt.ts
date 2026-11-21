import { TOOL_CATALOG } from "./catalog";

/** The stored parts of an agent that make up its prompt. */
export interface PromptParts {
  role: string;
  rules: string[];
  tools: string[];
  toolNotes: unknown;
}

/**
 * Build the system prompt from the agent's stored parts.
 * Only enabled tools are listed, and only their notes are included, so turning a tool off
 * removes every mention of it.
 * @param parts the agent's role, rules, enabled tools and per-tool notes
 * @return the full system prompt
 */
export function buildSystemPrompt(parts: PromptParts): string {
  const notes = (parts.toolNotes && typeof parts.toolNotes === "object" ? parts.toolNotes : {}) as Record<string, unknown>;
  const enabled = TOOL_CATALOG.filter((t) => parts.tools.includes(t.name));
  const out: string[] = [parts.role.trim()];

  if (enabled.length > 0) {
    out.push(`You can use these tools:\n${enabled.map((t) => `- ${t.name}: ${t.summary}`).join("\n")}`);
    const guidance = enabled.flatMap((t) => (typeof notes[t.name] === "string" && (notes[t.name] as string).trim() ? [`${t.name}: ${(notes[t.name] as string).trim()}`] : []));
    if (guidance.length > 0) out.push(`How to use them:\n${guidance.map((g) => `- ${g}`).join("\n")}`);
  } else {
    out.push("You have no tools. Answer from the conversation only, and say so when you cannot look something up.");
  }

  const rules = parts.rules.map((r) => r.trim()).filter(Boolean);
  if (rules.length > 0) out.push(`Rules:\n${rules.map((r) => `- ${r}`).join("\n")}`);

  return out.filter(Boolean).join("\n\n");
}
