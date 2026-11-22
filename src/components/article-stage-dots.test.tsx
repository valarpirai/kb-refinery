// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArticleStageDots, summarizeSteps, type DotState, type DotStep } from "./article-stage-dots";

const KEYS = ["import", "convert", "analyze", "enrich", "rewrite", "ready"] as const;

/**
 * Build six steps with the given states.
 * @param states state per step, in order
 */
function steps(states: DotState[]): DotStep[] {
  return states.map((state, i) => ({ key: KEYS[i], label: KEYS[i].toUpperCase(), state }));
}

describe("summarizeSteps", () => {
  it("reports the failed step first", () => {
    expect(summarizeSteps(steps(["done", "done", "failed", "active", "queued", "pending"]))).toBe("analyze failed");
  });
  it("reports the active step when nothing failed", () => {
    expect(summarizeSteps(steps(["done", "active", "queued", "pending", "pending", "pending"]))).toBe("convert running");
  });
  it("reports a queued step", () => {
    expect(summarizeSteps(steps(["done", "done", "queued", "pending", "pending", "pending"]))).toBe("analyze queued");
  });
  it("reports ready when the last step is done", () => {
    expect(summarizeSteps(steps(["done", "done", "done", "done", "done", "done"]))).toBe("ready");
  });
  it("reports not started otherwise", () => {
    expect(summarizeSteps(steps(["pending", "pending", "pending", "pending", "pending", "pending"]))).toBe("not started");
  });
});

describe("ArticleStageDots", () => {
  it("labels the whole pipeline in words", () => {
    render(<ArticleStageDots steps={steps(["done", "failed", "pending", "pending", "pending", "pending"])} />);
    expect(screen.getByRole("img", { name: "Pipeline: convert failed" })).toBeInTheDocument();
  });

  it("lists each step state in the tooltip", () => {
    render(<ArticleStageDots steps={steps(["done", "active", "queued", "skipped", "pending", "pending"])} />);
    expect(screen.getByRole("img")).toHaveAttribute("title", "IMPORT: done\nCONVERT: active\nANALYZE: queued\nENRICH: skipped\nREWRITE: pending\nREADY: pending");
  });

  it("renders one dot per step and marks only failed ones with an exclamation", () => {
    render(<ArticleStageDots steps={steps(["done", "failed", "pending", "pending", "failed", "pending"])} />);
    const dots = screen.getByRole("img").children;
    expect(dots).toHaveLength(6);
    expect([...dots].map((d) => d.textContent)).toEqual(["", "!", "", "", "!", ""]);
  });
});
