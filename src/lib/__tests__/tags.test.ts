import { describe, expect, it } from "vitest";
import { MAX_TAGS_PER_ARTICLE, normalizeTag } from ".././tags";

describe("normalizeTag", () => {
  it("trims, collapses spaces and lowercases", () => {
    expect(normalizeTag("  Hello   World ")).toBe("hello world");
  });
  it("collapses tabs and newlines", () => {
    expect(normalizeTag("a\t\nb")).toBe("a b");
  });
  it("returns null for empty or blank input", () => {
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
  });
  it("accepts exactly 40 characters and rejects 41", () => {
    expect(normalizeTag("a".repeat(40))).toBe("a".repeat(40));
    expect(normalizeTag("a".repeat(41))).toBeNull();
  });
  it("measures length after normalizing", () => {
    expect(normalizeTag(`  ${"a".repeat(40)}  `)).toBe("a".repeat(40));
  });
});

describe("MAX_TAGS_PER_ARTICLE", () => {
  it("is 20", () => {
    expect(MAX_TAGS_PER_ARTICLE).toBe(20);
  });
});
