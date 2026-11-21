import { OpenAIModel } from "@strands-agents/sdk/models/openai";

/** The model, pointed at Ollama's OpenAI-compatible endpoint. */
export function makeModel() {
  return new OpenAIModel({
    api: "chat",
    modelId: process.env.OLLAMA_MODEL ?? "qwen3:4b-thinking-2507-q4_K_M",
    apiKey: "ollama",
    clientConfig: { baseURL: `${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}/v1` },
  });
}
