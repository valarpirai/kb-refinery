// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentForm, type AgentData } from "./agent-form";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const agent: AgentData = {
  slug: "helper",
  name: "Helper",
  description: "Helps",
  role: "You are a helper.",
  rules: ["Be brief", "Be kind"],
  tools: ["get_stats"],
  toolNotes: { get_stats: "Use for counts" },
};

/**
 * Stub fetch with one response.
 * @param ok whether the response is ok
 * @param body json body
 * @param status http status
 */
function stubFetch(ok: boolean, body: unknown = {}, status = ok ? 200 : 400) {
  const f = vi.fn().mockResolvedValue({ ok, status, json: async () => body });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("AgentForm", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("shows the saved values and a prompt preview built from them", () => {
    render(<AgentForm agent={agent} canEdit />);
    expect(screen.getByLabelText("Name")).toHaveValue("Helper");
    expect(screen.getByLabelText(/^Rules/)).toHaveValue("Be brief\nBe kind");
    const pre = document.querySelector("pre")!;
    expect(pre.textContent).toContain("You are a helper.");
    expect(pre.textContent).toContain("get_stats");
    expect(pre.textContent).toContain("Use for counts");
    expect(pre.textContent).toContain("- Be brief");
  });

  it("updates the preview as the role is edited", async () => {
    render(<AgentForm agent={agent} canEdit />);
    const role = screen.getByLabelText(/^Role/);
    await userEvent.clear(role);
    await userEvent.type(role, "New role");
    expect(document.querySelector("pre")!.textContent).toContain("New role");
  });

  it("shows a note box only for ticked tools", async () => {
    render(<AgentForm agent={agent} canEdit />);
    expect(screen.getAllByLabelText("When to use it")).toHaveLength(1);
    await userEvent.click(screen.getByRole("checkbox", { name: /Search articles/ }));
    expect(screen.getAllByLabelText("When to use it")).toHaveLength(2);
    await userEvent.click(screen.getByRole("checkbox", { name: /Search articles/ }));
    expect(screen.getAllByLabelText("When to use it")).toHaveLength(1);
  });

  it("saves with PATCH, trims rules, sends ticked tools and refreshes", async () => {
    const f = stubFetch(true);
    render(<AgentForm agent={agent} canEdit />);
    await userEvent.type(screen.getByLabelText(/^Rules/), "\n   \n  Third  ");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved. The next message uses it."));
    expect(f).toHaveBeenCalledWith("/api/agents/helper", expect.objectContaining({ method: "PATCH" }));
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.rules).toEqual(["Be brief", "Be kind", "Third"]);
    expect(body.tools).toEqual(["get_stats"]);
    expect(body.toolNotes).toEqual({ get_stats: "Use for counts" });
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the server error and no saved message on failure", async () => {
    stubFetch(false, { error: "Name taken" });
    render(<AgentForm agent={agent} canEdit />);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Name taken");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("falls back to the HTTP status when the error has no message", async () => {
    stubFetch(false, {}, 500);
    render(<AgentForm agent={agent} canEdit />);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save (HTTP 500).");
  });

  it("reports a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    render(<AgentForm agent={agent} canEdit />);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server. Try again.");
  });

  it("disables the button and shows Saving while the request runs", async () => {
    let release!: (v: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((r) => (release = r))));
    render(<AgentForm agent={agent} canEdit />);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    release({ ok: true, status: 200, json: async () => ({}) });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled());
  });

  it("clears the saved message after another edit", async () => {
    stubFetch(true);
    render(<AgentForm agent={agent} canEdit />);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved. The next message uses it.");
    await userEvent.type(screen.getByLabelText("Name"), "x");
    expect(screen.queryByText("Saved. The next message uses it.")).not.toBeInTheDocument();
  });

  it("is read-only for people who cannot edit", () => {
    render(<AgentForm agent={agent} canEdit={false} />);
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Search articles/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByText("Only admins can edit agents.")).toBeInTheDocument();
  });
});
