import { describe, expect, it } from "vitest";
import { label } from "@/lib/format";

describe("label", () => {
  it("turns an enum value into readable text", () => {
    expect(label("completed_with_errors")).toBe("Completed with errors");
  });

  it("returns an empty string for null", () => {
    expect(label(null)).toBe("");
  });
});
