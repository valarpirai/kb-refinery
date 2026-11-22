import { describe, expect, it } from "vitest";
import { SPAN_KIND, STAGE_COLORS, spanKind, type SpanKind } from ".././colors";

describe("spanKind", () => {
  it.each<[string, SpanKind]>([
    ["invoke_agent Refinery", "agent"],
    ["invoke_agent", "agent"],
    ["execute_agent_loop_cycle", "loop"],
    ["chat", "model"],
    ["chat qwen3", "model"],
    ["execute_tool search_articles", "tool"],
    ["kb_refinery.agent_chat", "request"],
    ["process refine-article", "queue"],
    ["send agent-message", "queue"],
    ["complete refine-article", "queue"],
    ["something else", "other"],
    ["", "other"],
  ])("maps %j to %s", (name, kind) => {
    expect(spanKind(name)).toBe(kind);
  });

  it("does not treat a name that merely starts with chat as a model call", () => {
    expect(spanKind("chatty")).toBe("other");
  });

  it("requires a space after tool and queue prefixes", () => {
    expect(spanKind("execute_tool")).toBe("other");
    expect(spanKind("process")).toBe("other");
  });
});

describe("color tables", () => {
  it("defines a label and full color set for every span kind", () => {
    for (const kind of ["agent", "loop", "model", "tool", "request", "queue", "other"] as SpanKind[]) {
      const { label, colors } = SPAN_KIND[kind];
      expect(label).toBeTruthy();
      expect(Object.keys(colors).sort()).toEqual(["border", "ring", "soft", "solid", "text"]);
    }
  });

  it("defines the six pipeline stages", () => {
    expect(Object.keys(STAGE_COLORS)).toEqual(["import", "convert", "analyze", "enrich", "rewrite", "ready"]);
  });
});
