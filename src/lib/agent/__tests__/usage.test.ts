import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { $queryRaw: vi.fn() } }));

import { db } from "@/lib/db";
import { getAgentUsage } from ".././usage";

const admin = { id: "a", name: "A", email: "a@x", role: "admin" as const };
const user = { id: "u", name: "U", email: "u@x", role: "user" as const };
const since = new Date("2026-01-01T00:00:00Z");
const q = () => vi.mocked(db.$queryRaw);

function mockRows(days: unknown[], tools: unknown[], spans: unknown[]) {
  q().mockResolvedValueOnce(days as never).mockResolvedValueOnce(tools as never).mockResolvedValueOnce(spans as never);
}

/** Flatten the bound values of every query call. */
const boundValues = () => q().mock.calls.flatMap((c) => c.slice(1)).flatMap((v) => (v && typeof v === "object" && "values" in v ? (v as { values: unknown[] }).values : [v]));

describe("getAgentUsage", () => {
  it("sums runs and failures across days", async () => {
    const d1 = { day: new Date("2026-01-01"), runs: 3, failed: 1 };
    const d2 = { day: new Date("2026-01-02"), runs: 2, failed: 0 };
    mockRows([d1, d2], [], [{ tokens: 1200, avg_ms: 4000 }]);
    const out = await getAgentUsage(admin, since);
    expect(out.totals).toEqual({ runs: 5, failed: 1, completed: 4, tokens: 1200, avgRunMs: 4000 });
    expect(out.days).toEqual([d1, d2]);
  });

  it("returns zero totals and null token numbers when there is no data", async () => {
    mockRows([], [], []);
    const out = await getAgentUsage(admin, since);
    expect(out.totals).toEqual({ runs: 0, failed: 0, completed: 0, tokens: null, avgRunMs: null });
    expect(out.tools).toEqual([]);
  });

  it("returns null tokens when the aggregate is null", async () => {
    mockRows([{ day: since, runs: 1, failed: 0 }], [], [{ tokens: null, avg_ms: null }]);
    const out = await getAgentUsage(admin, since);
    expect(out.totals.tokens).toBeNull();
    expect(out.totals.avgRunMs).toBeNull();
  });

  it("renames avg_ms to avgMs for tools", async () => {
    mockRows([], [{ tool: "get_stats", calls: 4, errors: 1, avg_ms: 120.5 }, { tool: "x", calls: 1, errors: 0, avg_ms: null }], []);
    const out = await getAgentUsage(admin, since);
    expect(out.tools).toEqual([
      { tool: "get_stats", calls: 4, errors: 1, avgMs: 120.5 },
      { tool: "x", calls: 1, errors: 0, avgMs: null },
    ]);
  });

  it("limits a normal user to their own runs", async () => {
    mockRows([], [], []);
    await getAgentUsage(user, since);
    expect(boundValues()).toContain("u");
  });

  it("does not filter admins by user", async () => {
    mockRows([], [], []);
    await getAgentUsage(admin, since);
    expect(boundValues()).not.toContain("a");
    expect(boundValues()).toContain(since);
  });
});
