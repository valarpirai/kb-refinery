// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReindexButton } from "./reindex-button";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("ReindexButton", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("queues a rebuild, says so, and refreshes after 4 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const f = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", f);
    render(<ReindexButton />);
    await userEvent.click(screen.getByRole("button", { name: "Rebuild index" }));
    expect(f).toHaveBeenCalledWith("/api/chat/index", { method: "POST" });
    expect(await screen.findByText("Queued. Refresh in a moment.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(refresh).toHaveBeenCalled();
  });

  it("says Failed when the server refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<ReindexButton />);
    await userEvent.click(screen.getByRole("button", { name: "Rebuild index" }));
    expect(await screen.findByText("Failed")).toBeInTheDocument();
  });
});
