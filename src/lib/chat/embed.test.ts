import { afterEach, describe, expect, it, vi } from "vitest";
import { embed, toVectorLiteral } from "./embed";

afterEach(() => vi.unstubAllGlobals());

const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });

describe("toVectorLiteral", () => {
  it("formats numbers as a pgvector literal", () => {
    expect(toVectorLiteral([0.1, 0.2, -3])).toBe("[0.1,0.2,-3]");
  });
  it("formats an empty vector", () => {
    expect(toVectorLiteral([])).toBe("[]");
  });
});

describe("embed", () => {
  it("returns an empty list without calling the network for no input", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(embed([], "query")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefixes each text with the task kind and posts to Ollama", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ embeddings: [[1], [2]] }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await embed(["a", "b"], "document");
    expect(out).toEqual([[1], [2]]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/embed$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).input).toEqual(["search_document: a", "search_document: b"]);
  });

  it("uses the query prefix for questions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ embeddings: [[1]] }));
    vi.stubGlobal("fetch", fetchMock);
    await embed(["q"], "query");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input).toEqual(["search_query: q"]);
  });

  it("throws with status and truncated body on an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "e".repeat(500) }));
    const err = await embed(["a"], "query").catch((e: Error) => e);
    expect((err as Error).message).toBe(`Ollama embed 500: ${"e".repeat(200)}`);
  });

  it("throws when embeddings are missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({})));
    await expect(embed(["a"], "query")).rejects.toThrow("wrong shape");
  });

  it("throws when the embedding count does not match the input", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ embeddings: [[1]] })));
    await expect(embed(["a", "b"], "query")).rejects.toThrow("wrong shape");
  });
});
