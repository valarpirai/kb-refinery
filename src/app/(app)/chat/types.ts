export type Verdict = "original" | "refined" | "tie" | "neither";

export interface Source {
  n: number;
  articleId: string;
  analysisId: string | null;
  title: string;
  heading: string | null;
  score: number;
  excerpt: string;
}

export interface Arm {
  id: string;
  variant: "original" | "refined";
  status: "pending" | "running" | "completed" | "failed";
  answer: string | null;
  sources: Source[];
  latencyMs: number | null;
  error: string | null;
  judge: { score: number; reasoning: string } | null;
}

export interface ComparisonData {
  id: string;
  conversationId: string;
  query: string;
  verdict: Verdict | null;
  note: string | null;
  createdAt: string;
  arms: Arm[];
}

export interface ConversationItem {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
  status: "running" | "success" | "error";
  startedAt?: string;
  endedAt?: string;
}

export interface ChatMessageData {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "streaming" | "completed" | "failed";
  toolCalls: ToolCall[];
  error: string | null;
  traceId: string | null;
  createdAt: string;
}

/** An agent a person can pick for a new conversation. */
export interface AgentOption {
  slug: string;
  name: string;
  description: string;
}

export interface ConversationData {
  id: string;
  title: string;
  agentSlug: string;
  comparisons: ComparisonData[];
  messages: ChatMessageData[];
}

export type ChatMode = "agent" | "compare";

export type Tally = Record<Verdict, number>;

export interface IndexStatus {
  indexed: number;
  total: number;
}
