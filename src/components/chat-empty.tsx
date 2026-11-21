"use client";

const SUGGESTIONS = [
  "How do I reset my VPN password?",
  "What is the process for requesting new hardware?",
  "Why can't I open a shared mailbox in Outlook?",
  "How do I set up multi-factor authentication?",
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
      <p className="chat-lede">Ask one question. You get an answer from the original docs and one from the refined docs, side by side.</p>
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
