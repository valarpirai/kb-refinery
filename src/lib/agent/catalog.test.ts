import { describe, expect, it } from "vitest";
import { TOOL_CATALOG, TOOL_NAMES } from "./catalog";

describe("TOOL_CATALOG", () => {
  it("has unique names with a label and summary", () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_CATALOG.length);
    for (const t of TOOL_CATALOG) {
      expect(t.label).toBeTruthy();
      expect(t.summary).toBeTruthy();
    }
  });

  it("derives TOOL_NAMES in catalog order", () => {
    expect(TOOL_NAMES).toEqual(TOOL_CATALOG.map((t) => t.name));
  });
});
