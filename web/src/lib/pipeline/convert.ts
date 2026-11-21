import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
turndown.use(gfm);
turndown.remove(["script", "style", "noscript"]);

/**
 * Convert an article body to Markdown.
 * HTML is converted. Markdown and plain text pass through unchanged.
 * @param body the stored article body
 * @param format the body's format
 * @return Markdown text
 */
export function toMarkdown(body: string, format: string): string {
  if (format !== "html") return body.trim();
  return turndown.turndown(body).trim();
}
