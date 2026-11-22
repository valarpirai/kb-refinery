// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefinePicker } from "./refine-picker";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const rows = [
  { id: "a1", title: "VPN setup", knowledgeBase: "IT", analysis: { pipelineStage: "ready" } },
  { id: "a2", title: "Printers", knowledgeBase: null, analysis: null },
];

/**
 * Stub fetch: article search answers with rows, jobs with the given response.
 * @param job response for POST /api/jobs
 */
function stubFetch(job: { ok: boolean; body: unknown } = { ok: true, body: { id: "j1" } }) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const f = vi.fn(async (url: string, _init?: RequestInit) => (url.startsWith("/api/articles") ? { ok: true, json: async () => rows } : { ok: job.ok, json: async () => job.body }));
  vi.stubGlobal("fetch", f);
  return f;
}

/** Open the dialog and wait for the list. */
async function open() {
  await userEvent.click(screen.getByRole("button", { name: "Refine articles" }));
  await screen.findByText("VPN setup");
}

describe("RefinePicker", () => {
  beforeEach(() => {
    // jsdom has no modal dialog support, so mimic the open attribute.
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens a dialog with articles, their knowledge base and stage", async () => {
    stubFetch();
    render(<RefinePicker />);
    await open();
    expect(screen.getByText("IT · ready")).toBeInTheDocument();
    expect(screen.getByText("No knowledge base · not analyzed")).toBeInTheDocument();
  });

  it("searches by title after a short pause, with the query encoded", async () => {
    const f = stubFetch();
    render(<RefinePicker />);
    await open();
    await userEvent.type(screen.getByLabelText("Search articles"), "a&b");
    await waitFor(() => expect(f).toHaveBeenCalledWith("/api/articles?q=a%26b"));
  });

  it("disables Refine selected until something is picked, and counts picks", async () => {
    stubFetch();
    render(<RefinePicker />);
    await open();
    expect(screen.getByRole("button", { name: /^Refine\s*selected$/ })).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/VPN setup/));
    await userEvent.click(screen.getByLabelText(/Printers/));
    expect(screen.getByRole("button", { name: "Refine 2 selected" })).toBeEnabled();
    await userEvent.click(screen.getByLabelText(/Printers/));
    expect(screen.getByRole("button", { name: "Refine 1 selected" })).toBeInTheDocument();
  });

  it("starts a job for the picked articles and opens it", async () => {
    const f = stubFetch();
    render(<RefinePicker />);
    await open();
    await userEvent.click(screen.getByLabelText(/VPN setup/));
    await userEvent.click(screen.getByRole("button", { name: "Refine 1 selected" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/jobs/j1"));
    const post = f.mock.calls.find((c) => c[0] === "/api/jobs")!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ articleIds: ["a1"] });
  });

  it("Refine all sends an empty body", async () => {
    const f = stubFetch();
    render(<RefinePicker />);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Refine all" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/jobs/j1"));
    const post = f.mock.calls.find((c) => c[0] === "/api/jobs")!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({});
  });

  it("shows the server error and stays put", async () => {
    stubFetch({ ok: false, body: { error: "Nothing to refine" } });
    render(<RefinePicker />);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Refine all" }));
    expect(await screen.findByText("Nothing to refine")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Refine all" })).toBeEnabled();
  });

  it("Cancel closes the dialog", async () => {
    stubFetch();
    const { container } = render(<RefinePicker />);
    await open();
    expect(container.querySelector("dialog")).toHaveAttribute("open");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(container.querySelector("dialog")).not.toHaveAttribute("open");
  });

  it("says when no articles match", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<RefinePicker />);
    await userEvent.click(screen.getByRole("button", { name: "Refine articles" }));
    expect(await screen.findByText("No articles found.")).toBeInTheDocument();
    await act(async () => {});
  });

  it("shows an error and frees the button when starting the job fails on the network", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/articles")) return { ok: true, json: async () => rows };
      throw new Error("offline");
    }));
    render(<RefinePicker />);
    await open();
    await userEvent.click(screen.getByLabelText(/VPN setup/));
    await userEvent.click(screen.getByRole("button", { name: "Refine 1 selected" }));
    expect(await screen.findByText("Could not start the job")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refine 1 selected" })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps the shown rows when the search fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<RefinePicker />);
    await userEvent.click(screen.getByRole("button", { name: "Refine articles" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(screen.getByRole("dialog", { hidden: true })).toBeInTheDocument();
  });
});
