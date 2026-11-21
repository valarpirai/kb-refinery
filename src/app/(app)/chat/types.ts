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

export interface ConversationData {
  id: string;
  title: string;
  comparisons: ComparisonData[];
}

export type Tally = Record<Verdict, number>;

export interface IndexStatus {
  indexed: number;
  total: number;
}
