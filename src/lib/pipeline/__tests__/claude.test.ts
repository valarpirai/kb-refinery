import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const h = vi.hoisted(() => {
  class AuthenticationError extends Error {}
  class NotFoundError extends Error {}
  return {
    AuthenticationError,
    NotFoundError,
    stream: vi.fn(),
    retrieve: vi.fn(),
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    static AuthenticationError = h.AuthenticationError;
    static NotFoundError = h.NotFoundError;
    messages = { stream: h.stream };
    models = { retrieve: h.retrieve };
  }
  return { default: Anthropic };
});

import { CLAUDE_MODEL, checkClaude, chatJsonClaude } from ".././claude";

const schema = z.object({ n: z.number() });

/**
 * Make stream() resolve to a final message.
 * @param msg the final message
 * @return the stream mock
 */
const final = (msg: object) => ({ finalMessage: async () => msg });
const textMsg = (text: string, extra: object = {}) => ({ stop_reason: "end_turn", content: [{ type: "text", text }], ...extra });

describe("chatJsonClaude", () => {
  beforeEach(() => {
    h.stream.mockReset();
  });

  it("parses a valid reply and returns empty thinking", async () => {
    h.stream.mockReturnValueOnce(final(textMsg('{"n":4}')));
    expect(await chatJsonClaude("hi", schema)).toEqual({ data: { n: 4 }, thinking: "" });
  });

  it("sends model, prompt and low effort by default, high when thinking", async () => {
    h.stream.mockImplementation(() => final(textMsg('{"n":1}')));
    await chatJsonClaude("hello", schema);
    await chatJsonClaude("hello", schema, { think: true });
    const a = h.stream.mock.calls[0][0];
    const b = h.stream.mock.calls[1][0];
    expect(a.model).toBe(CLAUDE_MODEL);
    expect(a.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(a.output_config.effort).toBe("low");
    expect(b.output_config.effort).toBe("high");
    expect(a.output_config.format).toBeDefined();
  });

  it("joins multiple text blocks and ignores other block types", async () => {
    h.stream.mockReturnValueOnce(final({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "x" }, { type: "text", text: '{"n"' }, { type: "text", text: ":2}" }] }));
    expect((await chatJsonClaude("p", schema)).data.n).toBe(2);
  });

  it("strips a code fence", async () => {
    h.stream.mockReturnValueOnce(final(textMsg('```json\n{"n":8}\n```')));
    expect((await chatJsonClaude("p", schema)).data.n).toBe(8);
  });

  it("retries once on an invalid reply", async () => {
    h.stream.mockReturnValueOnce(final(textMsg("oops"))).mockReturnValueOnce(final(textMsg('{"n":3}')));
    expect((await chatJsonClaude("p", schema)).data.n).toBe(3);
    expect(h.stream).toHaveBeenCalledTimes(2);
  });

  it("fails after two bad replies", async () => {
    h.stream.mockImplementation(() => final(textMsg('{"n":"bad"}')));
    await expect(chatJsonClaude("p", schema)).rejects.toThrow(/Model reply did not match the expected shape/);
    expect(h.stream).toHaveBeenCalledTimes(2);
  });

  it("throws on a refusal, with the category when given, without retrying", async () => {
    h.stream.mockReturnValueOnce(final({ stop_reason: "refusal", content: [], stop_details: { category: "cyber" } }));
    await expect(chatJsonClaude("p", schema)).rejects.toThrow("Claude declined this request (cyber)");
    expect(h.stream).toHaveBeenCalledTimes(1);
  });

  it("throws on a refusal without a category", async () => {
    h.stream.mockReturnValueOnce(final({ stop_reason: "refusal", content: [] }));
    await expect(chatJsonClaude("p", schema)).rejects.toThrow(/^Claude declined this request$/);
  });

  it("throws a clear error when the output limit is hit", async () => {
    h.stream.mockReturnValueOnce(final({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"n":' }] }));
    await expect(chatJsonClaude("p", schema)).rejects.toThrow(/output limit.*ANTHROPIC_MAX_TOKENS/);
    expect(h.stream).toHaveBeenCalledTimes(1);
  });

  it("propagates API errors", async () => {
    h.stream.mockReturnValueOnce({ finalMessage: async () => { throw new Error("503"); } });
    await expect(chatJsonClaude("p", schema)).rejects.toThrow("503");
  });
});

describe("checkClaude", () => {
  beforeEach(() => h.retrieve.mockReset());

  it("returns null when the model exists", async () => {
    h.retrieve.mockResolvedValueOnce({});
    expect(await checkClaude()).toBeNull();
    expect(h.retrieve).toHaveBeenCalledWith(CLAUDE_MODEL);
  });

  it("explains rejected credentials", async () => {
    h.retrieve.mockRejectedValueOnce(new h.AuthenticationError("401"));
    expect(await checkClaude()).toBe("Claude rejected the credentials. Set ANTHROPIC_API_KEY.");
  });

  it("explains an unknown model", async () => {
    h.retrieve.mockRejectedValueOnce(new h.NotFoundError("404"));
    expect(await checkClaude()).toBe(`Claude model ${CLAUDE_MODEL} was not found`);
  });

  it("reports other failures with a truncated message", async () => {
    h.retrieve.mockRejectedValueOnce(new Error("x".repeat(500)));
    const msg = await checkClaude();
    expect(msg).toBe(`Cannot reach the Claude API: ${"x".repeat(120)}`);
  });
});
