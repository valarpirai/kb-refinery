import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const anthropic = vi.fn();
const openai = vi.fn();
vi.mock("@strands-agents/sdk/models/anthropic", () => ({
  AnthropicModel: class {
    constructor(o: unknown) {
      anthropic(o);
    }
  },
}));
vi.mock("@strands-agents/sdk/models/openai", () => ({
  OpenAIModel: class {
    constructor(o: unknown) {
      openai(o);
    }
  },
}));

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllEnvs());

async function load(provider: "anthropic" | "ollama") {
  vi.doMock("@/lib/pipeline/llm", () => ({ LLM_PROVIDER: provider }));
  vi.doMock("@/lib/pipeline/claude", () => ({ CLAUDE_MODEL: "claude-test" }));
  return (await import("./model")).makeModel;
}

describe("makeModel", () => {
  it("builds an Anthropic model with the default token cap", async () => {
    const makeModel = await load("anthropic");
    makeModel();
    expect(anthropic).toHaveBeenCalledWith({ modelId: "claude-test", maxTokens: 16000 });
    expect(openai).not.toHaveBeenCalled();
  });

  it("reads the Anthropic token cap from the environment", async () => {
    vi.stubEnv("ANTHROPIC_MAX_TOKENS", "500");
    const makeModel = await load("anthropic");
    makeModel();
    expect(anthropic).toHaveBeenCalledWith({ modelId: "claude-test", maxTokens: 500 });
  });

  it("builds an Ollama model with defaults", async () => {
    vi.stubEnv("OLLAMA_MODEL", "");
    delete process.env.OLLAMA_MODEL;
    delete process.env.OLLAMA_BASE_URL;
    const makeModel = await load("ollama");
    makeModel();
    expect(openai).toHaveBeenCalledWith({
      api: "chat",
      modelId: "qwen3:4b-thinking-2507-q4_K_M",
      apiKey: "ollama",
      clientConfig: { baseURL: "http://localhost:11434/v1" },
    });
    expect(anthropic).not.toHaveBeenCalled();
  });

  it("uses the Ollama model and URL from the environment", async () => {
    vi.stubEnv("OLLAMA_MODEL", "llama3");
    vi.stubEnv("OLLAMA_BASE_URL", "http://host:1");
    const makeModel = await load("ollama");
    makeModel();
    expect(openai).toHaveBeenCalledWith(expect.objectContaining({ modelId: "llama3", clientConfig: { baseURL: "http://host:1/v1" } }));
  });
});
