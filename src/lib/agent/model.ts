import { AnthropicModel } from "@strands-agents/sdk/models/anthropic";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { LLM_PROVIDER } from "@/lib/pipeline/llm";
import { CLAUDE_MODEL } from "@/lib/pipeline/claude";

/** The agent's model: Claude when LLM_PROVIDER is "anthropic", otherwise Ollama's OpenAI-compatible endpoint. */
export function makeModel() {
  if (LLM_PROVIDER === "anthropic") {
    return new AnthropicModel({ modelId: CLAUDE_MODEL, maxTokens: Number(process.env.ANTHROPIC_MAX_TOKENS ?? 16_000) });
  }
  return new OpenAIModel({
    api: "chat",
    modelId: process.env.OLLAMA_MODEL ?? "qwen3:4b-thinking-2507-q4_K_M",
    apiKey: "ollama",
    clientConfig: { baseURL: `${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}/v1` },
  });
}
