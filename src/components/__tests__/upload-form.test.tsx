// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UploadForm } from ".././upload-form";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const md = new File(["# hi"], "a.md", { type: "text/markdown" });
const md2 = new File(["# yo"], "b.md", { type: "text/markdown" });

describe("UploadForm", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("has the upload button disabled until a file is chosen, and counts files", async () => {
    render(<UploadForm />);
    expect(screen.getByRole("button", { name: /^Upload/ })).toBeDisabled();
    await userEvent.upload(screen.getByLabelText("Files"), md);
    expect(screen.getByRole("button", { name: "Upload 1 file" })).toBeEnabled();
    await userEvent.upload(screen.getByLabelText("Files"), [md, md2]);
    expect(screen.getByRole("button", { name: "Upload 2 files" })).toBeEnabled();
  });

  it("changes accepted types and hides the agent option for incidents", async () => {
    render(<UploadForm />);
    expect(screen.getByLabelText("Files")).toHaveAttribute("accept", expect.stringContaining(".md"));
    expect(screen.getByLabelText(/Let the agent refine/)).toBeChecked();
    await userEvent.click(screen.getByLabelText("Incidents"));
    expect(screen.getByLabelText("Files")).toHaveAttribute("accept", ".csv,.json");
    expect(screen.queryByLabelText(/Let the agent refine/)).not.toBeInTheDocument();
  });

  it("clears chosen files when the kind changes", async () => {
    render(<UploadForm />);
    await userEvent.upload(screen.getByLabelText("Files"), md);
    await userEvent.click(screen.getByLabelText("Incidents"));
    expect(screen.getByRole("button", { name: /^Upload/ })).toBeDisabled();
  });

  it("uploads form data with kind, agent flag and files, then shows the result", async () => {
    const result = { label: "Articles", status: "completed", total: 2, created: 1, updated: 1, skipped: 0, errors: [], agentConversationId: "c7" };
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal("fetch", f);
    render(<UploadForm />);
    await userEvent.upload(screen.getByLabelText("Files"), [md, md2]);
    await userEvent.click(screen.getByRole("button", { name: "Upload 2 files" }));
    expect(await screen.findByText("Articles: 1 created, 1 updated, 0 unchanged.")).toBeInTheDocument();
    const body = f.mock.calls[0][1].body as FormData;
    expect(f.mock.calls[0][0]).toBe("/api/import");
    expect(body.get("kind")).toBe("articles");
    expect(body.get("agent")).toBe("1");
    expect(body.getAll("files")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Watch it work" })).toHaveAttribute("href", "/chat?c=c7");
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Upload/ })).toBeDisabled();
  });

  it("sends agent 0 when the box is unticked", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ label: "A", created: 0, updated: 0, skipped: 0, errors: [] }) });
    vi.stubGlobal("fetch", f);
    render(<UploadForm />);
    await userEvent.click(screen.getByLabelText(/Let the agent refine/));
    await userEvent.upload(screen.getByLabelText("Files"), md);
    await userEvent.click(screen.getByRole("button", { name: "Upload 1 file" }));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect((f.mock.calls[0][1].body as FormData).get("agent")).toBe("0");
  });

  it("lists up to 10 import problems", async () => {
    const errors = Array.from({ length: 12 }, (_, i) => `row ${i} bad`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ label: "A", created: 0, updated: 0, skipped: 0, errors }) }));
    render(<UploadForm />);
    await userEvent.upload(screen.getByLabelText("Files"), md);
    await userEvent.click(screen.getByRole("button", { name: "Upload 1 file" }));
    expect(await screen.findByText(/12 problem\(s\)/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
  });

  it("shows the server error and keeps the files", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Too large" }) }));
    render(<UploadForm />);
    await userEvent.upload(screen.getByLabelText("Files"), md);
    await userEvent.click(screen.getByRole("button", { name: "Upload 1 file" }));
    expect(await screen.findByText("Too large")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload 1 file" })).toBeEnabled();
  });

  it("explains a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    render(<UploadForm />);
    await userEvent.upload(screen.getByLabelText("Files"), md);
    await userEvent.click(screen.getByRole("button", { name: "Upload 1 file" }));
    expect(await screen.findByText("Upload failed. Is the server running?")).toBeInTheDocument();
  });

  it("shows Uploading while busy", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<UploadForm />);
    await userEvent.upload(screen.getByLabelText("Files"), md);
    await userEvent.click(screen.getByRole("button", { name: "Upload 1 file" }));
    expect(screen.getByRole("button", { name: "Uploading…" })).toBeDisabled();
  });
});
