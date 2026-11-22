import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@/lib/session", () => ({ getUser: h.getUser, unauthorized: () => Response.json({ error: "Sign in required" }, { status: 401 }) }));
vi.mock("@/lib/events", () => ({ subscribe: h.subscribe }));

import { GET } from ".././route";

describe("GET /api/events", () => {
  beforeEach(() => {
    h.getUser.mockResolvedValue({ id: "u1", role: "user" });
    h.subscribe.mockReturnValue(h.unsubscribe);
  });

  it("returns 401 without a session and does not subscribe", async () => {
    h.getUser.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/events"));
    expect(res.status).toBe(401);
    expect(h.subscribe).not.toHaveBeenCalled();
  });

  it("returns an event stream that opens with a retry hint", async () => {
    const ac = new AbortController();
    const res = await GET(new Request("http://localhost/api/events", { signal: ac.signal }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(res.body).toBeInstanceOf(ReadableStream);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("retry: 3000");
    ac.abort();
    expect(h.unsubscribe).toHaveBeenCalled();
  });
});
