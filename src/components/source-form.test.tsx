// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SourceForm } from "./source-form";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("SourceForm", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("starts on the REST type and switches to a page list", async () => {
    render(<SourceForm />);
    expect(screen.getByLabelText("URL")).toBeInTheDocument();
    expect(screen.queryByLabelText("Page URLs, one per line")).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Type"), "url_crawl");
    expect(screen.getByLabelText("Page URLs, one per line")).toBeInTheDocument();
    expect(screen.queryByLabelText("URL")).not.toBeInTheDocument();
  });

  it("posts a REST source with its config, then resets and refreshes", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    render(<SourceForm />);
    await userEvent.type(screen.getByLabelText("Name"), "  Help API ");
    await userEvent.type(screen.getByLabelText("URL"), "https://example.com/api");
    await userEvent.type(screen.getByLabelText(/Path to the list/), "result");
    await userEvent.selectOptions(screen.getByLabelText("Records are"), "incidents");
    await userEvent.type(screen.getByLabelText("Schedule"), "0 2 * * *");
    await userEvent.click(screen.getByRole("button", { name: "Add source" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({
      name: "Help API", type: "rest_json", cron: "0 2 * * *",
      config: { url: "https://example.com/api", itemsPath: "result", kind: "incidents" },
    });
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("posts a crawl source with one URL per line", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    render(<SourceForm />);
    await userEvent.selectOptions(screen.getByLabelText("Type"), "url_crawl");
    await userEvent.type(screen.getByLabelText("Name"), "Pages");
    await userEvent.type(screen.getByLabelText("Page URLs, one per line"), "https://a.io/1{Enter}  https://a.io/2 {Enter}{Enter}");
    await userEvent.type(screen.getByLabelText(/Authorization header/), "Bearer t");
    await userEvent.click(screen.getByRole("button", { name: "Add source" }));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(JSON.parse(f.mock.calls[0][1].body).config).toEqual({ urls: ["https://a.io/1", "https://a.io/2"], authHeader: "Bearer t" });
    expect(JSON.parse(f.mock.calls[0][1].body).type).toBe("url_crawl");
  });

  it("shows the server error and does not refresh", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Bad URL" }) }));
    render(<SourceForm />);
    await userEvent.type(screen.getByLabelText("Name"), "X");
    await userEvent.type(screen.getByLabelText("URL"), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add source" }));
    expect(await screen.findByText("Bad URL")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveValue("X");
  });

  it("shows Saving while busy", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<SourceForm />);
    await userEvent.type(screen.getByLabelText("Name"), "X");
    await userEvent.type(screen.getByLabelText("URL"), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add source" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("offers the schedule presets", () => {
    const { container } = render(<SourceForm />);
    const labels = [...container.querySelectorAll("datalist option")].map((o) => o.textContent);
    expect(labels).toEqual(["Manual only", "Every hour", "Every 6 hours", "Daily at 02:00", "Weekly, Monday 02:00"]);
  });

  it("shows an error and frees the button when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<SourceForm />);
    await userEvent.type(screen.getByLabelText("Name"), "X");
    await userEvent.type(screen.getByLabelText("URL"), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: "Add source" }));
    expect(await screen.findByText("Could not save")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add source" })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
