import { AnthropicModel } from "@strands-agents/sdk/models/anthropic";
import { BedrockModel } from "@strands-agents/sdk/models/bedrock";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { LLM_PROVIDER } from "@/lib/pipeline/llm";
import { CLAUDE_MODEL } from "@/lib/pipeline/claude";
import { BEDROCK_MODEL } from "@/lib/pipeline/bedrock";

/** The agent's model: Claude on Bedrock or the Claude API, or otherwise Ollama's OpenAI-compatible endpoint. */
export function makeModel() {
  if (LLM_PROVIDER === "bedrock") {
    return new BedrockModel({ modelId: BEDROCK_MODEL, region: process.env.AWS_REGION ?? "us-east-1", maxTokens: Number(process.env.BEDROCK_MAX_TOKENS ?? 16_000) });
  }
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
