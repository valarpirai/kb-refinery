// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ContentViewer, type Version } from ".././content-viewer";

const versions: Version[] = [
  { type: "raw", format: "html", content: "<h1>Raw</h1><script>alert(1)</script>" },
  { type: "converted", format: "markdown", content: "# Converted title\n\nSome **bold** text" },
  { type: "enriched", format: "markdown", content: "## Rewritten title" },
];

describe("ContentViewer", () => {
  it("starts on the last version", () => {
    render(<ContentViewer versions={versions} />);
    expect(screen.getByRole("tab", { name: "Rewritten" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Rewritten title" })).toBeInTheDocument();
  });

  it("switches tabs and renders markdown", async () => {
    render(<ContentViewer versions={versions} />);
    await userEvent.click(screen.getByRole("tab", { name: "Converted" }));
    expect(screen.getByRole("heading", { name: "Converted title" })).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "tab-converted");
  });

  it("shows original HTML as plain text and never injects it", async () => {
    const { container } = render(<ContentViewer versions={versions} />);
    await userEvent.click(screen.getByRole("tab", { name: "Original" }));
    expect(screen.getByText("<h1>Raw</h1><script>alert(1)</script>")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Raw" })).not.toBeInTheDocument();
  });

  it("does not run raw HTML inside markdown", async () => {
    const v: Version[] = [{ type: "converted", format: "markdown", content: "hi <img src=x onerror=alert(1)> <script>bad()</script>" }];
    const { container } = render(<ContentViewer versions={v} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders raw markdown (non-html) as markdown", () => {
    render(<ContentViewer versions={[{ type: "raw", format: "markdown", content: "# From raw" }]} />);
    expect(screen.getByRole("heading", { name: "From raw" })).toBeInTheDocument();
  });

  it("shows a message when there are no versions", () => {
    render(<ContentViewer versions={[]} />);
    expect(screen.getByText("No content at this stage.")).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});
