import { describe, expect, it } from "vitest";
import { refinedFirst } from "./blind";

describe("refinedFirst", () => {
  it("is stable for the same id", () => {
    expect(refinedFirst("abc")).toBe(refinedFirst("abc"));
  });

  it("is true when the char code sum is odd", () => {
    expect(refinedFirst("a")).toBe(true); // 97
    expect(refinedFirst("b")).toBe(false); // 98
    expect(refinedFirst("ab")).toBe(true); // 195
  });

  it("is false for an empty id", () => {
    expect(refinedFirst("")).toBe(false);
  });

  it("produces both outcomes across ids", () => {
    const results = new Set(["a", "b", "c", "d"].map(refinedFirst));
    expect(results).toEqual(new Set([true, false]));
  });
});
