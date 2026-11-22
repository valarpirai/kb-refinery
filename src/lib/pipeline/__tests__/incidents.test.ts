import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { incident: { findMany: vi.fn() } } }));

import { db } from "@/lib/db";
import { findCandidateIncidents } from ".././incidents";

const findMany = () => vi.mocked(db.incident.findMany);

describe("findCandidateIncidents", () => {
  it("returns [] without querying when there are no usable terms", async () => {
    expect(await findCandidateIncidents([])).toEqual([]);
    expect(await findCandidateIncidents(["", "   "])).toEqual([]);
    expect(findMany()).not.toHaveBeenCalled();
  });

  it("matches each term against description and resolution, case-insensitively", async () => {
    findMany().mockResolvedValue([] as never);
    await findCandidateIncidents(["vpn", "mfa"]);
    const arg = findMany().mock.calls[0][0]!;
    expect(arg.where!.OR).toEqual([
      { shortDescription: { contains: "vpn", mode: "insensitive" } },
      { resolution: { contains: "vpn", mode: "insensitive" } },
      { shortDescription: { contains: "mfa", mode: "insensitive" } },
      { resolution: { contains: "mfa", mode: "insensitive" } },
    ]);
  });

  it("only returns incidents that have a resolution, newest first, capped at 20", async () => {
    findMany().mockResolvedValue([] as never);
    await findCandidateIncidents(["a"]);
    const arg = findMany().mock.calls[0][0]!;
    expect(arg.where!.resolution).toEqual({ not: "" });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.take).toBe(20);
  });

  it("trims terms and drops blanks", async () => {
    findMany().mockResolvedValue([] as never);
    await findCandidateIncidents(["  vpn  ", "", "  "]);
    const or = findMany().mock.calls[0][0]!.where!.OR as { shortDescription?: { contains: string } }[];
    expect(or).toHaveLength(2);
    expect(or[0].shortDescription!.contains).toBe("vpn");
  });

  it("uses at most the first eight terms", async () => {
    findMany().mockResolvedValue([] as never);
    await findCandidateIncidents(Array.from({ length: 12 }, (_, i) => `t${i}`));
    const or = findMany().mock.calls[0][0]!.where!.OR as unknown[];
    expect(or).toHaveLength(16);
  });

  it("returns what the database returns", async () => {
    const rows = [{ id: "1", number: "INC1" }];
    findMany().mockResolvedValue(rows as never);
    expect(await findCandidateIncidents(["x"])).toBe(rows);
  });

  it("propagates database errors", async () => {
    findMany().mockRejectedValue(new Error("db down"));
    await expect(findCandidateIncidents(["x"])).rejects.toThrow("db down");
  });
});
