import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), runImport: vi.fn(), start: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/ingest/import", () => ({ runImport: h.runImport }));
vi.mock("@/lib/agent/start", () => ({ startAgentTurn: h.start }));

import { POST } from ".././route";

/**
 * Build a multipart request.
 * @param fields plain form fields
 * @param files file name and text pairs added under "files"
 * @return the request
 */
function form(fields: Record<string, string>, files: [string, string][] = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [name, text] of files) fd.append("files", new File([text], name));
  return new Request("http://localhost/api/import", { method: "POST", body: fd });
}

describe("POST /api/import", () => {
  beforeEach(() => {
    h.getUser.mockResolvedValue({ id: "u1", role: "user" });
    h.runImport.mockResolvedValue({ id: "run1", created: 2, updated: 1 });
    h.start.mockResolvedValue({ conversationId: "conv1" });
  });

  it("returns 401 without a session", async () => {
    h.getUser.mockResolvedValue(null);
    expect((await POST(form({ kind: "articles" }, [["a.md", "x"]]))).status).toBe(401);
  });

  it("imports files and starts an agent turn for new or changed articles", async () => {
    const res = await POST(form({ kind: "articles" }, [["a.md", "hello"], ["b.md", "world"]]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "run1", created: 2, updated: 1, agentConversationId: "conv1" });
    expect(h.runImport).toHaveBeenCalledWith({ kind: "articles", files: [{ name: "a.md", text: "hello" }, { name: "b.md", text: "world" }], userId: "u1" });
    expect(h.start.mock.calls[0][1]).toContain("a.md, b.md");
  });

  it("summarizes more than three files in the agent prompt", async () => {
    await POST(form({ kind: "articles" }, ["a", "b", "c", "d", "e"].map((n) => [n + ".md", n] as [string, string])));
    expect(h.start.mock.calls[0][1]).toContain("a.md, b.md, c.md and 2 more");
  });

  it("skips the agent when agent=0", async () => {
    const res = await POST(form({ kind: "articles", agent: "0" }, [["a.md", "x"]]));
    expect((await res.json()).agentConversationId).toBeNull();
    expect(h.start).not.toHaveBeenCalled();
  });

  it("skips the agent for incidents", async () => {
    await POST(form({ kind: "incidents" }, [["i.csv", "x"]]));
    expect(h.start).not.toHaveBeenCalled();
  });

  it("skips the agent when nothing was created or updated", async () => {
    h.runImport.mockResolvedValue({ id: "run1", created: 0, updated: 0 });
    await POST(form({ kind: "articles" }, [["a.md", "x"]]));
    expect(h.start).not.toHaveBeenCalled();
  });

  it("still succeeds when the agent fails to start", async () => {
    h.start.mockRejectedValue(new Error("boom"));
    const res = await POST(form({ kind: "articles" }, [["a.md", "x"]]));
    expect(res.status).toBe(200);
    expect((await res.json()).agentConversationId).toBeNull();
  });

  it("returns 400 for an unknown kind", async () => {
    const res = await POST(form({ kind: "videos" }, [["a.md", "x"]]));
    expect(res.status).toBe(400);
    expect(h.runImport).not.toHaveBeenCalled();
  });

  it("returns 400 when no files are sent", async () => {
    const res = await POST(form({ kind: "articles" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("no files");
  });

  it("returns 413 for more than 200 files", async () => {
    const files = Array.from({ length: 201 }, (_, i) => [`f${i}.md`, "x"] as [string, string]);
    expect((await POST(form({ kind: "articles" }, files))).status).toBe(413);
  });

  it("returns 413 for a file over 10 MB", async () => {
    const res = await POST(form({ kind: "articles" }, [["big.md", "x".repeat(10 * 1024 * 1024 + 1)]]));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toContain("big.md");
    expect(h.runImport).not.toHaveBeenCalled();
  });
});
