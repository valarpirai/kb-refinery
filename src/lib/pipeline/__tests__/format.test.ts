import { describe, expect, it } from "vitest";
import { formatFindings, formatIncidents, jsonOrNone } from ".././format";

describe("formatFindings", () => {
  it("returns (none) for an empty list", () => {
    expect(formatFindings([])).toBe("(none)");
  });

  it("labels findings from F1 in order", () => {
    const out = formatFindings([
      { type: "outdated", severity: "high", detail: "old" },
      { type: "too_vague", severity: "low", detail: "vague" },
    ]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("[F1] outdated (high): old");
    expect(lines[1]).toBe("[F2] too_vague (low): vague");
  });

  it("includes location and quote when present", () => {
    const out = formatFindings([{ type: "incomplete", severity: "medium", location: "Step 2", evidence: "TBD", detail: "missing" }]);
    expect(out).toBe('[F1] incomplete (medium) in "Step 2": missing Quote: "TBD".');
  });

  it("defaults severity to medium and detail to empty", () => {
    expect(formatFindings([{ type: "duplicate", severity: null, detail: null }])).toBe("[F1] duplicate (medium): ");
    expect(formatFindings([{ type: "duplicate" }])).toBe("[F1] duplicate (medium): ");
  });

  it("omits location and quote when empty strings", () => {
    expect(formatFindings([{ type: "x", severity: "low", location: "", evidence: "", detail: "d" }])).toBe("[F1] x (low): d");
  });
});

describe("formatIncidents", () => {
  it("returns (none) for an empty list", () => {
    expect(formatIncidents([])).toBe("(none)");
  });

  it("renders one block per incident", () => {
    const out = formatIncidents([
      { number: "INC1", shortDescription: "VPN down", resolution: "Restart" },
      { number: "INC2", shortDescription: "No mail", resolution: "Reset" },
    ]);
    expect(out).toBe("- INC1: VPN down\n  Resolution: Restart\n- INC2: No mail\n  Resolution: Reset");
  });
});

describe("jsonOrNone", () => {
  it("returns (none) for null, undefined and empty arrays", () => {
    expect(jsonOrNone(null)).toBe("(none)");
    expect(jsonOrNone(undefined)).toBe("(none)");
    expect(jsonOrNone([])).toBe("(none)");
  });

  it("pretty prints other values with two-space indent", () => {
    expect(jsonOrNone({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(jsonOrNone(["x"])).toBe('[\n  "x"\n]');
  });

  it("keeps falsy but meaningful values", () => {
    expect(jsonOrNone(0)).toBe("0");
    expect(jsonOrNone("")).toBe('""');
    expect(jsonOrNone({})).toBe("{}");
  });
});
