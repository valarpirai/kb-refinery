import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const agentCtor = vi.fn();
vi.mock("@strands-agents/sdk", () => ({
  Agent: class {
    constructor(opts: unknown) {
      agentCtor(opts);
    }
    invoke = invoke;
  },
}));
vi.mock(".././model", () => ({ makeModel: vi.fn(() => "MODEL") }));
vi.mock("@/lib/db", () => ({ db: { agent: { findMany: vi.fn() } } }));

import { db } from "@/lib/db";
import { routeAgent } from ".././router";

const agents = (...slugs: string[]) => vi.mocked(db.agent.findMany).mockResolvedValue(slugs.map((slug) => ({ slug, description: `${slug} desc` })) as never);

describe("routeAgent", () => {
  it("returns the default without calling the model when there is one agent", async () => {
    agents("refinery");
    await expect(routeAgent("hi")).resolves.toBe("refinery");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns the only agent when it is not the default", async () => {
    agents("other");
    await expect(routeAgent("hi")).resolves.toBe("other");
  });

  it("returns the default slug when there are no agents", async () => {
    agents();
    await expect(routeAgent("hi")).resolves.toBe("refinery");
  });

  it("returns the slug the model names and lists agents in the prompt", async () => {
    agents("refinery", "analyst");
    invoke.mockResolvedValue("analyst");
    await expect(routeAgent("numbers please")).resolves.toBe("analyst");
    expect(invoke).toHaveBeenCalledWith("numbers please");
    const prompt = agentCtor.mock.calls[0][0].systemPrompt as string;
    expect(prompt).toContain("- analyst: analyst desc");
    expect(prompt).toContain("- refinery: refinery desc");
  });

  it("finds a slug inside surrounding words, ignoring case", async () => {
    agents("refinery", "Analyst");
    invoke.mockResolvedValue("<think>hmm</think> I pick ANALYST.");
    await expect(routeAgent("x")).resolves.toBe("Analyst");
  });

  it("falls back to the default when the model names no known agent", async () => {
    agents("refinery", "analyst");
    invoke.mockResolvedValue("banana");
    await expect(routeAgent("x")).resolves.toBe("refinery");
  });

  it("falls back to the first agent when the default is missing", async () => {
    agents("alpha", "beta");
    invoke.mockResolvedValue("nothing");
    await expect(routeAgent("x")).resolves.toBe("alpha");
  });

  it("falls back when the model throws", async () => {
    agents("refinery", "analyst");
    invoke.mockRejectedValue(new Error("llm down"));
    await expect(routeAgent("x")).resolves.toBe("refinery");
  });

  it("describes an agent with no description", async () => {
    vi.mocked(db.agent.findMany).mockResolvedValue([{ slug: "refinery", description: "" }, { slug: "b", description: "" }] as never);
    invoke.mockResolvedValue("b");
    await routeAgent("x");
    expect(agentCtor.mock.calls[0][0].systemPrompt).toContain("- b: no description");
  });
});
