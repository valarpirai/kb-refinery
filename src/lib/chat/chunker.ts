export interface ChunkDraft {
  heading: string | null;
  content: string;
}

const MAX_CHARS = 1200;
const MIN_CHARS = 200;

/** Heading line in Markdown (# Title) or HTML (<h2>Title</h2>). */
const HEADING = /^(?:#{1,6}\s+(.+)|<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>)\s*$/i;

/**
 * Split text on a size limit, preferring paragraph breaks.
 * @param text the section body
 * @return pieces no longer than the size limit, unless one paragraph is longer
 */
function splitBySize(text: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const para of text.split(/\n\s*\n/)) {
    if (current && current.length + para.length + 2 > MAX_CHARS) {
      out.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${para}` : para;
  }
  if (current.trim()) out.push(current);
  return out;
}

/**
 * Break an article into searchable chunks.
 * It splits at headings, then by size. Each chunk keeps its heading, and the
 * heading is repeated at the top of the chunk text so a chunk read alone still
 * says what it is about. Tiny trailing chunks are merged into the one before.
 * The same code runs for original and refined text, so only the content differs.
 * @param title the article title, used when a chunk has no heading
 * @param text the article content, as Markdown, HTML or plain text
 * @return chunks in reading order
 */
export function chunkArticle(title: string, text: string): ChunkDraft[] {
  const sections: { heading: string | null; lines: string[] }[] = [{ heading: null, lines: [] }];
  for (const line of text.split("\n")) {
    const m = HEADING.exec(line.trim());
    if (m) sections.push({ heading: (m[1] ?? m[2]).replace(/<[^>]+>/g, "").trim(), lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }

  const drafts: ChunkDraft[] = [];
  for (const s of sections) {
    const body = s.lines.join("\n").trim();
    if (!body) continue;
    for (const piece of splitBySize(body)) {
      const heading = s.heading ?? null;
      drafts.push({ heading, content: `${heading ?? title}\n\n${piece}`.trim() });
    }
  }

  const merged: ChunkDraft[] = [];
  for (const d of drafts) {
    const prev = merged[merged.length - 1];
    if (prev && d.content.length < MIN_CHARS && prev.content.length + d.content.length < MAX_CHARS * 1.5) {
      prev.content += `\n\n${d.content}`;
    } else {
      merged.push({ ...d });
    }
  }
  return merged.length ? merged : [{ heading: null, content: `${title}\n\n${text.trim()}`.trim() }];
}
