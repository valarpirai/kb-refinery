import { db } from "@/lib/db";

/**
 * Load a prompt template by name and fill its double-brace placeholders.
 * Unknown placeholders are left blank so a missing value never leaks the raw token.
 * @param name template name, for example kb_article_analysis
 * @param vars values keyed by placeholder name
 * @return the rendered prompt text
 */
export async function renderPrompt(name: string, vars: Record<string, string>): Promise<string> {
  const row = await db.promptTemplate.findUniqueOrThrow({ where: { name } });
  return row.template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key: string) => vars[key] ?? "");
}
