"use client";

import type { ChatMode } from "@/app/(app)/chat/types";

const SUGGESTIONS: Record<ChatMode, string[]> = {
  agent: [
    "Import the docs from https://example.com/help and refine them",
    "How many articles are refined and what is the average quality score?",
    "Which articles have the most open findings?",
  ],
  compare: [
    "How do I reset my VPN password?",
    "What is the process for requesting new hardware?",
    "Why can't I open a shared mailbox in Outlook?",
    "How do I set up multi-factor authentication?",
  ],
};

const LEDE: Record<ChatMode, string> = {
  agent: "Ask the agent to import, refine and look up your articles. You can see each step it takes.",
  compare: "Ask one question. You get an answer from the original docs and one from the refined docs, side by side.",
};

/**
 * Greeting shown when no conversation is open.
 * @param name the signed-in user's full name
 * @param mode the composer mode, which picks the examples
 * @param onPick called with the suggestion text when a chip is clicked
 */
export function ChatEmpty({ name, mode, onPick }: { name: string; mode: ChatMode; onPick: (text: string) => void }) {
  const first = name.trim().split(/\s+/)[0] || "there";
  return (
    <div className="chat-empty">
      <h2 className="chat-greeting font-serif">Hello, {first}</h2>
      <p className="chat-lede">{LEDE[mode]}</p>
      <ul className="chat-chips" aria-label="Example questions">
        {SUGGESTIONS[mode].map((s) => (
          <li key={s}>
            <button type="button" className="chat-chip chat-press" onClick={() => onPick(s)}>
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
