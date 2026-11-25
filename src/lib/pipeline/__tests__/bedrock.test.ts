import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const h = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    send = h.send;
  },
  ConverseCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { BEDROCK_MODEL, checkBedrock, chatJsonBedrock } from ".././bedrock";

const schema = z.object({ n: z.number() });
const reply = (text: string, stopReason = "end_turn") => ({ stopReason, output: { message: { content: [{ text }] } } });

describe("chatJsonBedrock", () => {
  beforeEach(() => h.send.mockReset());

  it("parses a valid reply and returns empty thinking", async () => {
    h.send.mockResolvedValueOnce(reply('{"n":4}'));
    expect(await chatJsonBedrock("hi", schema)).toEqual({ data: { n: 4 }, thinking: "" });
  });

  it("sends the model, prompt and a schema system message", async () => {
    h.send.mockResolvedValueOnce(reply('{"n":1}'));
    await chatJsonBedrock("hello", schema);
    const input = h.send.mock.calls[0][0].input;
    expect(input.modelId).toBe(BEDROCK_MODEL);
    expect(input.messages[0].content[0].text).toBe("hello");
    expect(input.system[0].text).toContain('"n"');
  });

  it("builds the prompt for a schema with transforms", async () => {
    const t = z.object({ s: z.string().nullish().transform((v) => v ?? "") });
    h.send.mockResolvedValueOnce(reply("{}"));
    expect((await chatJsonBedrock("p", t)).data).toEqual({ s: "" });
  });

  it("keeps a code fence inside a string value", async () => {
    const t = z.object({ s: z.string() });
    h.send.mockResolvedValueOnce(reply(JSON.stringify({ s: "run:\n```sh\nls\n```\ndone" })));
    expect((await chatJsonBedrock("p", t)).data.s).toContain("```sh");
  });

  it("accepts a fenced reply whose string holds a code fence", async () => {
    const t = z.object({ s: z.string() });
    const body = JSON.stringify({ s: "run:\n```sh\nls\n```\ndone" }, null, 2);
    h.send.mockResolvedValueOnce(reply("```json\n" + body + "\n```"));
    expect((await chatJsonBedrock("p", t)).data.s).toContain("```sh");
  });

  it("accepts a fenced reply", async () => {
    h.send.mockResolvedValueOnce(reply('```json\n{"n":2}\n```'));
    expect((await chatJsonBedrock("p", schema)).data).toEqual({ n: 2 });
  });

  it("retries once after a bad reply", async () => {
    h.send.mockResolvedValueOnce(reply("nope")).mockResolvedValueOnce(reply('{"n":3}'));
    expect((await chatJsonBedrock("p", schema)).data).toEqual({ n: 3 });
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it("throws after two bad replies", async () => {
    h.send.mockResolvedValue(reply("nope"));
    await expect(chatJsonBedrock("p", schema)).rejects.toThrow(/did not match/);
  });

  it("throws when the output limit is hit", async () => {
    h.send.mockResolvedValueOnce(reply("{", "max_tokens"));
    await expect(chatJsonBedrock("p", schema)).rejects.toThrow(/BEDROCK_MAX_TOKENS/);
  });
});

describe("checkBedrock", () => {
  beforeEach(() => h.send.mockReset());

  it("returns null when the model answers", async () => {
    h.send.mockResolvedValueOnce(reply("pong"));
    expect(await checkBedrock()).toBeNull();
  });

  it("reports rejected credentials", async () => {
    h.send.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "AccessDeniedException" }));
    expect(await checkBedrock()).toMatch(/rejected the credentials/);
  });

  it("reports an unreachable service", async () => {
    h.send.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await checkBedrock()).toMatch(/Cannot reach Bedrock/);
  });
});
