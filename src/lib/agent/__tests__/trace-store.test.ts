import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { traceSpan: { createMany: vi.fn() } } }));

import { db } from "@/lib/db";
import { PostgresSpanExporter } from ".././trace-store";

const createMany = () => vi.mocked(db.traceSpan.createMany);

function span(over: Record<string, unknown> = {}) {
  return {
    name: "chat",
    spanContext: () => ({ spanId: "s1", traceId: "t1" }),
    parentSpanContext: { spanId: "p1" },
    startTime: [1, 500_000_000],
    duration: [0, 250_000_000],
    status: { code: 1 },
    attributes: { a: "x", n: 3, u: undefined },
    ...over,
  } as never;
}

const run = (spans: unknown[]) => new Promise<{ code: number }>((resolve) => new PostgresSpanExporter().export(spans as never, resolve));

describe("PostgresSpanExporter", () => {
  it("saves spans with converted times and ids", async () => {
    createMany().mockResolvedValue({ count: 1 });
    await expect(run([span()])).resolves.toEqual({ code: 0 });
    const arg = createMany().mock.calls[0][0] as { skipDuplicates: boolean; data: Record<string, unknown>[] };
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data[0]).toEqual({
      spanId: "s1", traceId: "t1", parentId: "p1", name: "chat",
      startedAt: new Date(1500), durationMs: 250, status: "ok",
      attributes: { a: "x", n: 3 },
    });
  });

  it("marks status code 2 as error and a missing parent as null", async () => {
    createMany().mockResolvedValue({ count: 1 });
    await run([span({ status: { code: 2 }, parentSpanContext: undefined })]);
    const row = (createMany().mock.calls[0][0] as { data: Record<string, unknown>[] }).data[0];
    expect(row).toMatchObject({ status: "error", parentId: null });
  });

  it("cuts long string attributes at 8000 characters", async () => {
    createMany().mockResolvedValue({ count: 1 });
    await run([span({ attributes: { long: "z".repeat(9000), exact: "y".repeat(8000) } })]);
    const attrs = (createMany().mock.calls[0][0] as { data: { attributes: Record<string, string> }[] }).data[0].attributes;
    expect(attrs.long).toBe(`${"z".repeat(8000)}… [cut]`);
    expect(attrs.exact).toHaveLength(8000);
  });

  it("reports failure and warns when the save fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createMany().mockRejectedValue(new Error("db down"));
    await expect(run([span()])).resolves.toEqual({ code: 1 });
    expect(warn).toHaveBeenCalledWith("[traces] could not save spans:", "db down");
  });

  it("shuts down cleanly", async () => {
    await expect(new PostgresSpanExporter().shutdown()).resolves.toBeUndefined();
  });
});
