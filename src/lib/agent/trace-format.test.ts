import { describe, expect, it } from "vitest";
import { formatDuration, spanLabel, TOOL_PREFIX } from "./trace-format";

describe("spanLabel", () => {
  it.each([
    ["invoke_agent Refinery", "Agent run"],
    ["execute_agent_loop_cycle", "Agent loop cycle"],
    ["chat", "Model call"],
    ["chat qwen3", "Model call"],
    ["execute_tool get_stats", "Tool: get_stats"],
    ["kb_refinery.agent_chat", "Chat request"],
    ["process refine-article", "Worker: refine-article"],
    ["send agent-message", "Queued: agent-message"],
    ["complete refine-article", "Completed: refine-article"],
    ["unknown", "unknown"],
  ])("labels %j as %j", (name, label) => {
    expect(spanLabel(name)).toBe(label);
  });

  it("agrees with TOOL_PREFIX", () => {
    expect(spanLabel(`${TOOL_PREFIX}x`)).toBe("Tool: x");
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0 ms"],
    [849.6, "850 ms"],
    [999, "999 ms"],
    [1000, "1.0 s"],
    [12_400, "12.4 s"],
    [59_999, "1 min 0 s"],
    [60_000, "1 min 0 s"],
    [185_000, "3 min 5 s"],
  ])("formats %d ms as %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it("rounds seconds up without showing 60 s inside a minute", () => {
    expect(formatDuration(119_600)).toBe("2 min 0 s");
  });
});
