// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusPill } from ".././status-pill";

describe("StatusPill", () => {
  it("shows the status as readable text", () => {
    render(<StatusPill status="completed_with_errors" />);
    expect(screen.getByText("Completed with errors")).toBeInTheDocument();
  });

  it("uses red for failed and green for completed, so color matches the word", () => {
    const { rerender } = render(<StatusPill status="failed" />);
    expect(screen.getByText("Failed").className).toContain("red");
    rerender(<StatusPill status="completed" />);
    expect(screen.getByText("Completed").className).toContain("green");
  });
});
