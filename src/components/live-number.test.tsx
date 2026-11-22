// @vitest-environment jsdom
import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LiveNumber, useBump } from "./live-number";

vi.mock("./live-number.css", () => ({}));

describe("useBump", () => {
  it("starts at 0 and counts each change", () => {
    const { result, rerender } = renderHook(({ v }) => useBump(v), { initialProps: { v: 1 } });
    expect(result.current).toBe(0);
    rerender({ v: 1 });
    expect(result.current).toBe(0);
    rerender({ v: 2 });
    expect(result.current).toBe(1);
    rerender({ v: 3 });
    expect(result.current).toBe(2);
  });
});

describe("LiveNumber", () => {
  it("is plain text on first render", () => {
    render(<LiveNumber value={5} className="big" />);
    const el = screen.getByText("5");
    expect(el).toHaveClass("big");
    expect(el).not.toHaveClass("live-number");
  });

  it("animates when the value changes, and not when it stays the same", () => {
    const { rerender } = render(<LiveNumber value={5} />);
    rerender(<LiveNumber value={5} />);
    expect(screen.getByText("5")).not.toHaveClass("live-number");
    rerender(<LiveNumber value={6} />);
    expect(screen.getByText("6")).toHaveClass("live-number");
  });

  it("shows string values", () => {
    render(<LiveNumber value="12%" />);
    expect(screen.getByText("12%")).toBeInTheDocument();
  });
});
