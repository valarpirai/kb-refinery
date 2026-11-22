// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

type Tags = typeof import(".././article-tags");
let ArticleTags: Tags["ArticleTags"];

let tagList: unknown = [];

/**
 * Build a fetch mock that answers by method.
 * @param handler returns the response for a url and method
 */
function stubFetch(handler: (url: string, method: string) => { ok: boolean; status?: number; body?: unknown }) {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const r = url === "/api/tags" ? { ok: true, body: tagList } : handler(url, init?.method ?? "GET");
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 400), json: async () => r.body ?? {} };
  });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("ArticleTags", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    tagList = [];
    // The module keeps a tag-name cache, so load a clean copy per test.
    vi.resetModules();
    ArticleTags = (await import(".././article-tags")).ArticleTags;
  });

  it("lists the initial tags with remove buttons", () => {
    render(<ArticleTags articleId="a1" initial={[{ id: "t1", name: "vpn" }, { id: "t2", name: "email" }]} />);
    expect(screen.getByText("vpn")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove tag email" })).toBeInTheDocument();
  });

  it("adds a normalized tag on Enter and swaps in the server id", async () => {
    const f = stubFetch(() => ({ ok: true, body: { id: "t9", name: "my tag" } }));
    render(<ArticleTags articleId="a1" initial={[]} refresh />);
    await userEvent.type(screen.getByLabelText("Add tag"), "  My   TAG {Enter}");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(f).toHaveBeenCalledWith("/api/articles/a1/tags", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "my tag" }) }));
    expect(screen.getByText("my tag")).toBeInTheDocument();
    expect(screen.getByLabelText("Add tag")).toHaveValue("");
  });

  it("adds each part when a comma is typed", async () => {
    const f = stubFetch(() => ({ ok: true, body: { id: "id", name: "x" } }));
    render(<ArticleTags articleId="a1" initial={[]} />);
    await userEvent.type(screen.getByLabelText("Add tag"), "one,two,");
    const bodies = f.mock.calls.filter((c) => c[0] !== "/api/tags").map((c) => JSON.parse((c[1] as RequestInit).body as string).name);
    expect(bodies).toEqual(["one", "two"]);
  });

  it("does not call the server for duplicates or empty input", async () => {
    const f = stubFetch(() => ({ ok: true }));
    render(<ArticleTags articleId="a1" initial={[{ id: "t1", name: "vpn" }]} />);
    await userEvent.type(screen.getByLabelText("Add tag"), "VPN{Enter}");
    await userEvent.type(screen.getByLabelText("Add tag"), "   {Enter}");
    expect(f.mock.calls.filter((c) => c[0] !== "/api/tags")).toHaveLength(0);
    expect(screen.getAllByText("vpn")).toHaveLength(1);
  });

  it("rejects a tag longer than 40 characters", async () => {
    const f = stubFetch(() => ({ ok: true }));
    render(<ArticleTags articleId="a1" initial={[]} />);
    const input = screen.getByLabelText("Add tag");
    await userEvent.type(input, "a".repeat(41));
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("A tag is 1 to 40 characters.");
    expect(f.mock.calls.filter((c) => c[0] !== "/api/tags")).toHaveLength(0);
  });

  it("rejects the 21st tag", async () => {
    const f = stubFetch(() => ({ ok: true }));
    const initial = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, name: `tag${i}` }));
    render(<ArticleTags articleId="a1" initial={initial} />);
    await userEvent.type(screen.getByLabelText("Add tag"), "extra{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("up to 20 tags");
    expect(f.mock.calls.filter((c) => c[0] !== "/api/tags")).toHaveLength(0);
  });

  it("rolls the tag back and shows the error when the server refuses", async () => {
    stubFetch(() => ({ ok: false, body: { error: "Not allowed" } }));
    render(<ArticleTags articleId="a1" initial={[]} />);
    await userEvent.type(screen.getByLabelText("Add tag"), "nope{Enter}");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Not allowed"));
    expect(screen.queryByText("nope")).not.toBeInTheDocument();
  });

  it("shows the new tag at once, before the server answers", async () => {
    stubFetch(() => ({ ok: true, body: { id: "t1", name: "fast" } }));
    render(<ArticleTags articleId="a1" initial={[]} />);
    await userEvent.type(screen.getByLabelText("Add tag"), "fast{Enter}");
    expect(screen.getByText("fast")).toBeInTheDocument();
  });

  it("removes a tag with DELETE and refreshes", async () => {
    const f = stubFetch(() => ({ ok: true }));
    render(<ArticleTags articleId="a1" initial={[{ id: "t1", name: "vpn" }]} refresh />);
    await userEvent.click(screen.getByRole("button", { name: "Remove tag vpn" }));
    await waitFor(() => expect(screen.queryByText("vpn")).not.toBeInTheDocument());
    expect(f).toHaveBeenCalledWith("/api/articles/a1/tags/t1", { method: "DELETE" });
    expect(refresh).toHaveBeenCalled();
  });

  it("treats a 404 on remove as already gone", async () => {
    stubFetch(() => ({ ok: false, status: 404 }));
    render(<ArticleTags articleId="a1" initial={[{ id: "t1", name: "vpn" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove tag vpn" }));
    await waitFor(() => expect(screen.queryByText("vpn")).not.toBeInTheDocument());
  });

  it("keeps the tag and shows an error when remove fails", async () => {
    stubFetch(() => ({ ok: false, status: 500, body: { error: "Server broke" } }));
    render(<ArticleTags articleId="a1" initial={[{ id: "t1", name: "vpn" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove tag vpn" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Server broke"));
    expect(screen.getByText("vpn")).toBeInTheDocument();
  });

  it("loads suggestions once on focus, hiding tags already on the article", async () => {
    tagList = [{ name: "vpn" }, { name: "email" }];
    const f = stubFetch(() => ({ ok: true }));
    const { container } = render(<ArticleTags articleId="a1" initial={[{ id: "t1", name: "vpn" }]} />);
    const input = screen.getByLabelText("Add tag");
    await act(async () => input.focus());
    await waitFor(() => expect(container.querySelectorAll("datalist option")).toHaveLength(1));
    expect(container.querySelector("datalist option")).toHaveAttribute("value", "email");
    await act(async () => { input.blur(); input.focus(); });
    expect(f.mock.calls.filter((c) => c[0] === "/api/tags")).toHaveLength(1);
  });
});
