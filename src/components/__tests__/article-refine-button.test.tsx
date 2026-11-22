// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleRefineButton } from ".././article-refine-button";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("ArticleRefineButton", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("shows the default and a custom label", () => {
    const { rerender } = render(<ArticleRefineButton articleIds={["a"]} />);
    expect(screen.getByRole("button", { name: "Refine this article" })).toBeEnabled();
    rerender(<ArticleRefineButton articleIds={["a"]} label="Go" />);
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("posts the ids and opens the job page", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "job9" }) });
    vi.stubGlobal("fetch", f);
    render(<ArticleRefineButton articleIds={["a", "b"]} />);
    await userEvent.click(screen.getByRole("button"));
    expect(f).toHaveBeenCalledWith("/api/jobs", expect.objectContaining({ method: "POST", body: JSON.stringify({ articleIds: ["a", "b"] }) }));
    expect(push).toHaveBeenCalledWith("/jobs/job9");
  });

  it("is disabled and says Starting while the request runs", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<ArticleRefineButton articleIds={["a"]} />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
  });

  it("shows the server error and re-enables the button", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Busy" }) }));
    render(<ArticleRefineButton articleIds={["a"]} />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Busy");
    expect(screen.getByRole("button")).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });

  it("treats a response without an id as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    render(<ArticleRefineButton articleIds={["a"]} />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not start the job");
  });

  it("shows an error when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<ArticleRefineButton articleIds={["a"]} />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  });
});
