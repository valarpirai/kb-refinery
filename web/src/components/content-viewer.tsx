"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface Version {
  type: "raw" | "converted" | "enriched";
  content: string;
  format: string;
}

const NAMES = { raw: "Original", converted: "Converted", enriched: "Rewritten" } as const;

/** Tabbed view of an article's content at each stage. Markdown is rendered; raw source is shown as text. */
export function ContentViewer({ versions }: { versions: Version[] }) {
  const [active, setActive] = useState<Version["type"]>(versions[versions.length - 1]?.type ?? "raw");
  const current = versions.find((v) => v.type === active);

  return (
    <div>
      <div role="tablist" aria-label="Content stage" className="flex gap-1 border-b border-black/10 dark:border-white/15">
        {versions.map((v) => (
          <button
            key={v.type}
            role="tab"
            id={`tab-${v.type}`}
            aria-selected={active === v.type}
            aria-controls="content-panel"
            onClick={() => setActive(v.type)}
            className={`px-3 py-2 text-sm ${active === v.type ? "border-b-2 border-blue-600 font-medium" : "opacity-70"}`}
          >
            {NAMES[v.type]}
          </button>
        ))}
      </div>
      <div id="content-panel" role="tabpanel" aria-labelledby={`tab-${active}`} tabIndex={0} className="max-h-[32rem] overflow-auto rounded-b border border-t-0 border-black/10 p-4 dark:border-white/15">
        {!current ? (
          <p className="text-sm opacity-70">No content at this stage.</p>
        ) : active === "raw" && current.format === "html" ? (
          <pre className="whitespace-pre-wrap break-words text-xs">{current.content}</pre>
        ) : (
          <div className="space-y-3 text-sm [&_a]:text-blue-700 [&_a]:underline [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_pre]:overflow-auto [&_pre]:bg-black/5 [&_pre]:p-2 [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{current.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
