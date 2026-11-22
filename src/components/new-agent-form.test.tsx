// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewAgentForm } from "./new-agent-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const agents = [{ slug: "refinery", name: "Refinery" }];

/** Open the form and fill the required fields. */
async function fill() {
  await userEvent.click(screen.getByRole("button", { name: "New agent" }));
  await userEvent.type(screen.getByLabelText("Name"), " Analyst ");
  await userEvent.type(screen.getByLabelText("Role"), "You analyze.");
}

describe("NewAgentForm", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("starts as a button and opens the form, which Cancel closes again", async () => {
    render(<NewAgentForm agents={agents} />);
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New agent" }));
    expect(screen.getByRole("heading", { name: "New agent" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "New agent" })).toBeInTheDocument();
  });

  it("offers to copy from each existing agent", async () => {
    render(<NewAgentForm agents={agents} />);
    await userEvent.click(screen.getByRole("button", { name: "New agent" }));
    expect(screen.getByRole("option", { name: "Copy the rules and tools of Refinery" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Nothing. No tools and no rules." })).toBeInTheDocument();
  });

  it("creates the agent with trimmed values and opens it", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ slug: "analyst" }) });
    vi.stubGlobal("fetch", f);
    render(<NewAgentForm agents={agents} />);
    await fill();
    await userEvent.selectOptions(screen.getByLabelText("Start from"), "refinery");
    await userEvent.click(screen.getByRole("button", { name: "Create and open" }));
    expect(f).toHaveBeenCalledWith("/api/agents", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ name: "Analyst", description: "", role: "You analyze.", copyFrom: "refinery" });
    expect(push).toHaveBeenCalledWith("/agents/analyst");
  });

  it("leaves copyFrom out when nothing is chosen", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ slug: "a" }) });
    vi.stubGlobal("fetch", f);
    render(<NewAgentForm agents={agents} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Create and open" }));
    expect(JSON.parse(f.mock.calls[0][1].body)).not.toHaveProperty("copyFrom");
  });

  it("shows the server error and stays open", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "Name taken" }) }));
    render(<NewAgentForm agents={agents} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Create and open" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Name taken");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create and open" })).toBeEnabled();
  });

  it("falls back to the HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    render(<NewAgentForm agents={agents} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Create and open" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create it (HTTP 500).");
  });

  it("reports a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    render(<NewAgentForm agents={agents} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Create and open" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server. Try again.");
  });

  it("shows Creating while busy", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<NewAgentForm agents={agents} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Create and open" }));
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  });
});
