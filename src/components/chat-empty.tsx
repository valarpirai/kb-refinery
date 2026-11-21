"use client";

const SUGGESTIONS = [
  "How do I reset my VPN password?",
  "How many articles are refined and what is the average quality score?",
  "Import the docs from https://example.com/help and refine them",
  "Which articles have the most open findings?",
];

/**
 * Greeting shown when no conversation is open.
 * @param name the signed-in user's full name
 * @param onPick called with the suggestion text when a chip is clicked
 */
export function ChatEmpty({ name, onPick }: { name: string; onPick: (text: string) => void }) {
  const first = name.trim().split(/\s+/)[0] || "there";
  return (
    <div className="chat-empty">
      <h2 className="chat-greeting font-serif">Hello, {first}</h2>
      <p className="chat-lede">Ask a question about your articles, or ask me to import, refine and look things up. I pick the right agent for you.</p>
      <ul className="chat-chips" aria-label="Example questions">
        {SUGGESTIONS.map((s) => (
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
