import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const h = vi.hoisted(() => ({
  chatJsonClaude: vi.fn(),
  checkClaude: vi.fn(),
  chatJsonOllama: vi.fn(),
  checkOllama: vi.fn(),
}));

vi.mock(".././claude", () => ({ chatJsonClaude: h.chatJsonClaude, checkClaude: h.checkClaude }));
vi.mock(".././ollama", () => ({ chatJson: h.chatJsonOllama, checkOllama: h.checkOllama }));

const schema = z.object({ n: z.number() });

/**
 * Load llm.ts fresh with LLM_PROVIDER set.
 * @param provider value for LLM_PROVIDER, or undefined to unset it
 * @return the module
 */
async function load(provider?: string) {
  vi.resetModules();
  if (provider === undefined) vi.stubEnv("LLM_PROVIDER", "");
  else vi.stubEnv("LLM_PROVIDER", provider);
  return import(".././llm");
}

describe("llm provider routing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to ollama", async () => {
    const m = await load();
    expect(m.LLM_PROVIDER).toBe("ollama");
    h.chatJsonOllama.mockResolvedValue({ data: { n: 1 }, thinking: "" });
    await m.chatJson("p", schema, { think: true });
    expect(h.chatJsonOllama).toHaveBeenCalledWith("p", schema, { think: true });
    expect(h.chatJsonClaude).not.toHaveBeenCalled();
  });

  it("treats an unknown provider as ollama", async () => {
    expect((await load("openai")).LLM_PROVIDER).toBe("ollama");
  });

  it("routes to claude when LLM_PROVIDER is anthropic", async () => {
    const m = await load("anthropic");
    expect(m.LLM_PROVIDER).toBe("anthropic");
    h.chatJsonClaude.mockResolvedValue({ data: { n: 2 }, thinking: "" });
    expect(await m.chatJson("p", schema)).toEqual({ data: { n: 2 }, thinking: "" });
    expect(h.chatJsonClaude).toHaveBeenCalledWith("p", schema, {});
    expect(h.chatJsonOllama).not.toHaveBeenCalled();
  });

  it("checks the matching service", async () => {
    h.checkOllama.mockResolvedValue("ollama down");
    h.checkClaude.mockResolvedValue(null);
    expect(await (await load()).checkLlm()).toBe("ollama down");
    expect(await (await load("anthropic")).checkLlm()).toBeNull();
  });

  it("passes errors through", async () => {
    const m = await load("anthropic");
    h.chatJsonClaude.mockRejectedValue(new Error("boom"));
    await expect(m.chatJson("p", schema)).rejects.toThrow("boom");
  });
});
