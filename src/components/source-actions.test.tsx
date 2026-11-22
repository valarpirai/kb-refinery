// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SourceActions } from "./source-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

/**
 * Stub fetch.
 * @param ok whether the response is ok
 */
function stubFetch(ok = true) {
  const f = vi.fn().mockResolvedValue({ ok });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("SourceActions", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("Run now posts to the run endpoint and says it is queued", async () => {
    const f = stubFetch();
    render(<SourceActions id="s1" enabled name="Docs" />);
    await userEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(f).toHaveBeenCalledWith("/api/sources/s1/run", { method: "POST" });
    expect(await screen.findByText("Queued. The worker will pull it.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("an enabled source offers Pause, which sends enabled false", async () => {
    const f = stubFetch();
    render(<SourceActions id="s1" enabled name="Docs" />);
    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(f).toHaveBeenCalledWith("/api/sources/s1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: false }) }));
    expect(await screen.findByText("Paused")).toBeInTheDocument();
  });

  it("a disabled source offers Resume, which sends enabled true", async () => {
    const f = stubFetch();
    render(<SourceActions id="s1" enabled={false} name="Docs" />);
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ enabled: true });
    expect(await screen.findByText("Resumed")).toBeInTheDocument();
  });

  it("shows Failed when the server says no", async () => {
    stubFetch(false);
    render(<SourceActions id="s1" enabled name="Docs" />);
    await userEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(await screen.findByText("Failed")).toBeInTheDocument();
  });

  it("Delete asks first and does nothing when declined", async () => {
    const f = stubFetch();
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    render(<SourceActions id="s1" enabled name="Docs" />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Docs" }));
    expect(confirm).toHaveBeenCalledWith('Delete "Docs"? Imported articles stay.');
    expect(f).not.toHaveBeenCalled();
  });

  it("Delete sends DELETE once confirmed", async () => {
    const f = stubFetch();
    vi.stubGlobal("confirm", () => true);
    render(<SourceActions id="s1" enabled name="Docs" />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Docs" }));
    await waitFor(() => expect(f).toHaveBeenCalledWith("/api/sources/s1", { method: "DELETE" }));
    expect(await screen.findByText("Deleted")).toBeInTheDocument();
  });
});
