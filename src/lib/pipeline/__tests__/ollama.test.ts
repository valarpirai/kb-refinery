import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { chatJson, checkOllama, stripFence } from ".././ollama";

const schema = z.object({ n: z.number() });

/**
 * Build a streamed Ollama response from lines.
 * @param parts objects, each sent as one JSON line
 * @param chunkSize split the body into chunks of this many characters
 * @return a Response with an ndjson body
 */
function streamOf(parts: object[], chunkSize = 1000): Response {
  const text = parts.map((p) => JSON.stringify(p)).join("\n") + "\n";
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < text.length; i += chunkSize) c.enqueue(enc.encode(text.slice(i, i + chunkSize)));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

const reply = (content: string, thinking = "") => streamOf([{ message: { thinking } }, { message: { content } }]);

describe("stripFence", () => {
  it("returns plain text trimmed", () => {
    expect(stripFence('  {"a":1}\n')).toBe('{"a":1}');
  });
  it("removes a json fence", () => {
    expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("removes a bare fence and surrounding prose", () => {
    expect(stripFence('Here:\n```\n{"a":1}\n```\nDone')).toBe('{"a":1}');
  });
  it("is case-insensitive on the language tag", () => {
    expect(stripFence('```JSON\n[1]\n```')).toBe("[1]");
  });
});

describe("chatJson", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("parses a valid reply and returns thinking", async () => {
    fetchMock.mockResolvedValueOnce(reply('{"n":3}', "hmm"));
    expect(await chatJson("p", schema)).toEqual({ data: { n: 3 }, thinking: "hmm" });
  });

  it("joins content split across chunks and lines", async () => {
    fetchMock.mockResolvedValueOnce(streamOf([{ message: { content: '{"n"' } }, { message: { content: ":9}" } }], 7));
    expect((await chatJson("p", schema)).data).toEqual({ n: 9 });
  });

  it("accepts a fenced reply", async () => {
    fetchMock.mockResolvedValueOnce(reply('```json\n{"n":1}\n```'));
    expect((await chatJson("p", schema)).data.n).toBe(1);
  });

  it("sends model, stream, schema format and the prompt", async () => {
    fetchMock.mockResolvedValueOnce(reply('{"n":1}'));
    await chatJson("hello", schema);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse(init.body);
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(body.format.properties.n.type).toBe("number");
    expect(body.options.temperature).toBe(0.2);
    expect(init.method).toBe("POST");
  });

  it("passes the think option through in auto mode, defaulting to false", async () => {
    fetchMock.mockImplementation(async () => reply('{"n":1}'));
    await chatJson("p", schema);
    await chatJson("p", schema, { think: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).think).toBe(false);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).think).toBe(true);
  });

  it("retries once when the reply is not valid JSON", async () => {
    fetchMock.mockResolvedValueOnce(reply("not json")).mockResolvedValueOnce(reply('{"n":2}'));
    expect((await chatJson("p", schema)).data.n).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once when the reply fails the schema", async () => {
    fetchMock.mockResolvedValueOnce(reply('{"n":"x"}')).mockResolvedValueOnce(reply('{"n":5}'));
    expect((await chatJson("p", schema)).data.n).toBe(5);
  });

  it("fails after two bad replies", async () => {
    fetchMock.mockImplementation(async () => reply("nope"));
    await expect(chatJson("p", schema)).rejects.toThrow(/Model reply did not match the expected shape/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws with status and body on a non-OK response, without retrying", async () => {
    fetchMock.mockResolvedValueOnce(new Response("model missing", { status: 404 }));
    await expect(chatJson("p", schema)).rejects.toThrow("Ollama 404: model missing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("truncates a long error body to 300 chars", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x".repeat(1000), { status: 500 }));
    await expect(chatJson("p", schema)).rejects.toThrow(new RegExp(`^Ollama 500: x{300}$`));
  });

  it("throws when the stream carries an error line", async () => {
    fetchMock.mockResolvedValueOnce(streamOf([{ error: "out of memory" }]));
    await expect(chatJson("p", schema)).rejects.toThrow("Ollama: out of memory");
  });

  it("propagates network failures", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(chatJson("p", schema)).rejects.toThrow("ECONNREFUSED");
  });

  it("reads a final line that has no trailing newline", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('{"message":{"content":"{\\"n\\":4}"}}'));
        c.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(body));
    expect((await chatJson("p", schema)).data.n).toBe(4);
  });
});

describe("chatJson think override", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each([
    ["always", false, true],
    ["never", true, false],
  ])("OLLAMA_THINK=%s overrides opts.think=%s", async (mode, opt, expected) => {
    vi.stubEnv("OLLAMA_THINK", mode);
    vi.resetModules();
    const f = vi.fn().mockImplementation(async () => reply('{"n":1}'));
    vi.stubGlobal("fetch", f);
    const m = await import(".././ollama");
    await m.chatJson("p", schema, { think: opt });
    expect(JSON.parse(f.mock.calls[0][1].body).think).toBe(expected);
  });

  it("uses OLLAMA_BASE_URL and OLLAMA_MODEL", async () => {
    vi.stubEnv("OLLAMA_BASE_URL", "http://ollama.test:1");
    vi.stubEnv("OLLAMA_MODEL", "m1");
    vi.resetModules();
    const f = vi.fn().mockImplementation(async () => reply('{"n":1}'));
    vi.stubGlobal("fetch", f);
    const m = await import(".././ollama");
    await m.chatJson("p", schema);
    expect(f.mock.calls[0][0]).toBe("http://ollama.test:1/api/chat");
    expect(JSON.parse(f.mock.calls[0][1].body).model).toBe("m1");
  });
});

describe("checkOllama", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const json = (v: unknown) => new Response(JSON.stringify(v));

  it("returns null when the model is installed", async () => {
    fetchMock.mockResolvedValueOnce(json({ models: [{ name: "qwen3:4b-thinking-2507-q4_K_M" }] }));
    expect(await checkOllama()).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/tags");
  });

  it("reports a missing model", async () => {
    fetchMock.mockResolvedValueOnce(json({ models: [{ name: "other" }] }));
    expect(await checkOllama()).toBe("Model qwen3:4b-thinking-2507-q4_K_M is not installed in Ollama");
  });

  it("reports a missing models list", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    expect(await checkOllama()).toMatch(/is not installed/);
  });

  it("reports unreachable when fetch fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await checkOllama()).toBe("Cannot reach Ollama at http://localhost:11434");
  });

  it("reports unreachable when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>"));
    expect(await checkOllama()).toMatch(/Cannot reach Ollama/);
  });
});
