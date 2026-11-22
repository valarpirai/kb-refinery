import { describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ a: "b" })) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: (...a: unknown[]) => getSession(...a) } } }));

import { getUser, requirePageUser, unauthorized } from ".././session";

describe("getUser", () => {
  it("returns null without a session", async () => {
    getSession.mockResolvedValue(null);
    await expect(getUser()).resolves.toBeNull();
  });

  it("returns null when the session has no user", async () => {
    getSession.mockResolvedValue({});
    await expect(getUser()).resolves.toBeNull();
  });

  it("maps the session user and passes the request headers", async () => {
    getSession.mockResolvedValue({ user: { id: "1", name: "N", email: "e@x.com", role: "admin", extra: "ignored" } });
    await expect(getUser()).resolves.toEqual({ id: "1", name: "N", email: "e@x.com", role: "admin" });
    expect(getSession.mock.calls[0][0].headers.get("a")).toBe("b");
  });

  it("treats any non-admin role as user", async () => {
    getSession.mockResolvedValue({ user: { id: "1", name: "N", email: "e", role: "superuser" } });
    expect((await getUser())?.role).toBe("user");
    getSession.mockResolvedValue({ user: { id: "1", name: "N", email: "e" } });
    expect((await getUser())?.role).toBe("user");
  });
});

describe("requirePageUser", () => {
  it("returns the user when signed in", async () => {
    getSession.mockResolvedValue({ user: { id: "1", name: "N", email: "e" } });
    await expect(requirePageUser()).resolves.toMatchObject({ id: "1" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to /login when signed out", async () => {
    getSession.mockResolvedValue(null);
    await expect(requirePageUser()).rejects.toThrow("REDIRECT /login");
  });
});

describe("unauthorized", () => {
  it("is a 401 JSON response", async () => {
    const res = unauthorized();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Sign in required" });
  });
});
