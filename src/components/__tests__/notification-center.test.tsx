// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationCenter } from ".././notification-center";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock(".././notification-center.css", () => ({}));

const toasts = vi.hoisted(() => {
  const t = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() });
  return t;
});
vi.mock("sonner", () => ({ Toaster: () => null, toast: toasts }));

let live: ((e: { t: string } | null) => void) | null = null;
vi.mock("@/lib/use-live", () => ({ useLive: (h: typeof live) => { live = h; } }));

type N = { id: string; level: "info" | "success" | "warning" | "error"; title: string; body: string | null; href: string | null; readAt: string | null; createdAt: string };
/**
 * Build a notification.
 * @param id its id
 * @param over fields to override
 */
const note = (id: string, over: Partial<N> = {}): N => ({ id, level: "info", title: `Note ${id}`, body: null, href: null, readAt: null, createdAt: "2026-01-01T00:00:00Z", ...over });

let server: { unread: number; items: N[] };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  server = { unread: 2, items: [note("n1", { level: "success", body: "All done", href: "/jobs/1" }), note("n2", { readAt: "2026-01-02T00:00:00Z" })] };
  fetchMock = vi.fn(async (url: string) => (url === "/api/notifications" ? { ok: true, json: async () => server } : { ok: true, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("NotificationCenter", () => {
  it("shows the unread count on the bell and in its label", async () => {
    render(<NotificationCenter />);
    expect(await screen.findByRole("button", { name: "Notifications, 2 unread" })).toBeInTheDocument();
  });

  it("caps the visible badge at 99+", async () => {
    server.unread = 150;
    render(<NotificationCenter />);
    expect(await screen.findByText("99+")).toBeInTheDocument();
  });

  it("has a plain label and no badge when nothing is unread", async () => {
    server = { unread: 0, items: [] };
    render(<NotificationCenter />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });

  it("does not toast what is already there on first load", async () => {
    render(<NotificationCenter />);
    await screen.findByRole("button", { name: /2 unread/ });
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts).not.toHaveBeenCalled();
  });

  it("opens a list with level labels, bodies, and New on unread items only", async () => {
    render(<NotificationCenter />);
    await userEvent.click(await screen.findByRole("button", { name: /2 unread/ }));
    const pop = await screen.findByText("Note n2");
    expect(pop).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("All done")).toBeInTheDocument();
    expect(screen.getAllByText("New")).toHaveLength(1);
  });

  it("shows an empty message when there are none", async () => {
    server = { unread: 0, items: [] };
    render(<NotificationCenter />);
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeDisabled();
  });

  it("toasts new notifications after a live signal, by level, with an Open action", async () => {
    render(<NotificationCenter />);
    await screen.findByRole("button", { name: /2 unread/ });
    server = {
      unread: 5,
      items: [
        note("n4", { level: "error", title: "Pull failed", body: "HTTP 500", href: "/integrations" }),
        note("n3", { level: "warning", title: "Slow" }),
        ...server.items,
      ],
    };
    await act(async () => live!({ t: "Notification" }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(toasts.error).toHaveBeenCalledWith("Pull failed", { description: "HTTP 500", action: expect.objectContaining({ label: "Open" }) });
    expect(toasts.warning).toHaveBeenCalledWith("Slow", { description: undefined, action: undefined });
    const action = toasts.error.mock.calls[0][1].action;
    action.onClick();
    expect(push).toHaveBeenCalledWith("/integrations");
    // A second load must not toast them again.
    await act(async () => live!(null));
    expect(toasts.error).toHaveBeenCalledTimes(1);
  });

  it("ignores live signals for other tables", async () => {
    render(<NotificationCenter />);
    await screen.findByRole("button", { name: /2 unread/ });
    const calls = fetchMock.mock.calls.length;
    await act(async () => live!({ t: "Job" }));
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("marks one as read and opens its link when clicked", async () => {
    render(<NotificationCenter />);
    await userEvent.click(await screen.findByRole("button", { name: /2 unread/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Note n1/ }));
    expect(push).toHaveBeenCalledWith("/jobs/1");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/notifications/read", expect.objectContaining({ body: JSON.stringify({ ids: ["n1"] }) })));
  });

  it("does not mark an already-read item again", async () => {
    render(<NotificationCenter />);
    await userEvent.click(await screen.findByRole("button", { name: /2 unread/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Note n2/ }));
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/notifications/read")).toBe(false);
  });

  it("Mark all read posts an empty body", async () => {
    render(<NotificationCenter />);
    await userEvent.click(await screen.findByRole("button", { name: /2 unread/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Mark all read" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/notifications/read", expect.objectContaining({ method: "POST", body: "{}" }));
  });

  it("keeps working when loading fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<NotificationCenter />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
  });
});
