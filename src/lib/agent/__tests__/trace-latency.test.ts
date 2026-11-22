import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { $queryRaw: vi.fn() } }));

import { db } from "@/lib/db";
import { getKindLatency } from ".././trace-latency";

const stat = (kind: string) => ({ kind, spans: 1, errors: 0, p50: 1, p90: 2, p95: 3, p99: 4 });

describe("getKindLatency", () => {
  it("sorts rows into the display order", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue(["other", "tool", "agent", "queue", "model"].map(stat) as never);
    const out = await getKindLatency(new Date());
    expect(out.map((r) => r.kind)).toEqual(["agent", "model", "tool", "queue", "other"]);
  });

  it("returns an empty list when there are no spans", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([] as never);
    await expect(getKindLatency(new Date())).resolves.toEqual([]);
  });

  it("passes the since date to the query", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([] as never);
    const since = new Date("2026-01-01T00:00:00Z");
    await getKindLatency(since);
    expect(vi.mocked(db.$queryRaw).mock.calls[0].slice(1)).toContain(since);
  });
});
