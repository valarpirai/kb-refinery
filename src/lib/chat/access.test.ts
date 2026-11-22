import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { comparison: { findFirst: vi.fn() } } }));

import { db } from "@/lib/db";
import { ownedComparison } from "./access";

describe("ownedComparison", () => {
  it("scopes the lookup to the user and includes arms", async () => {
    const row = { id: "c1", arms: [] };
    vi.mocked(db.comparison.findFirst).mockResolvedValue(row as never);
    await expect(ownedComparison("c1", "u1")).resolves.toBe(row);
    expect(db.comparison.findFirst).toHaveBeenCalledWith({
      where: { id: "c1", conversation: { userId: "u1" } },
      include: { arms: true },
    });
  });

  it("returns null when the comparison is not found for that user", async () => {
    vi.mocked(db.comparison.findFirst).mockResolvedValue(null);
    await expect(ownedComparison("c1", "other")).resolves.toBeNull();
  });
});
