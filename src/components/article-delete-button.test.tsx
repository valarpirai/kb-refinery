// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleDeleteButton } from "./article-delete-button";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("./article-delete-button.css", () => ({}));

/**
 * Stub fetch with one response.
 * @param ok whether the response is ok
 * @param body json body
 */
function stubFetch(ok: boolean, body: unknown = {}) {
  const f = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal("fetch", f);
  return f;
}

/** Open the confirmation dialog. */
async function openDialog(label = "Delete") {
  await userEvent.click(screen.getByRole("button", { name: label }));
  return screen.findByRole("alertdialog");
}

describe("ArticleDeleteButton", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("asks before deleting and does not call the server yet", async () => {
    const f = stubFetch(true);
    render(<ArticleDeleteButton articleIds={["a"]} title="My Page" />);
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent("Delete “My Page”?");
    expect(f).not.toHaveBeenCalled();
  });

  it("uses a generic question without a title, and a count for many", async () => {
    const { unmount } = render(<ArticleDeleteButton articleIds={["a"]} />);
    expect(await openDialog()).toHaveTextContent("Delete this article?");
    unmount();
    render(<ArticleDeleteButton articleIds={["a", "b", "c"]} label="Delete (3)" />);
    const dialog = await openDialog("Delete (3)");
    expect(dialog).toHaveTextContent("Delete 3 articles?");
    expect(dialog).toHaveTextContent("removes them");
  });

  it("cancel closes the dialog without deleting", async () => {
    const f = stubFetch(true);
    render(<ArticleDeleteButton articleIds={["a"]} />);
    await openDialog();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(f).not.toHaveBeenCalled();
  });

  it("deletes, closes, calls onDone and refreshes", async () => {
    const f = stubFetch(true, { deleted: 1 });
    const onDone = vi.fn();
    render(<ArticleDeleteButton articleIds={["a", "b"]} onDone={onDone} />);
    await openDialog();
    const confirm = screen.getAllByRole("button", { name: "Delete" }).find((b) => b.closest("[role=alertdialog]"))!;
    await userEvent.click(confirm);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(f).toHaveBeenCalledWith("/api/articles/bulk-delete", expect.objectContaining({ method: "POST", body: JSON.stringify({ ids: ["a", "b"] }) }));
    expect(onDone).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("navigates to redirectTo instead of refreshing", async () => {
    stubFetch(true, { deleted: 1 });
    render(<ArticleDeleteButton articleIds={["a"]} redirectTo="/articles" />);
    await openDialog();
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" }).find((b) => b.closest("[role=alertdialog]"))!);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/articles"));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the server error and keeps the dialog open", async () => {
    stubFetch(false, { error: "Forbidden" });
    render(<ArticleDeleteButton articleIds={["a"]} />);
    await openDialog();
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" }).find((b) => b.closest("[role=alertdialog]"))!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports articles that were still busy, and refreshes for the ones deleted", async () => {
    stubFetch(true, { deleted: 2, busy: [{ title: "One" }, { title: "Two" }] });
    const onDone = vi.fn();
    render(<ArticleDeleteButton articleIds={["a", "b", "c", "d"]} onDone={onDone} />);
    await openDialog();
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" }).find((b) => b.closest("[role=alertdialog]"))!);
    expect(await screen.findByRole("alert")).toHaveTextContent("2 deleted. 2 still being processed and kept: One, Two.");
    expect(refresh).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("clears the error when the dialog is closed and reopened", async () => {
    stubFetch(false, { error: "Nope" });
    render(<ArticleDeleteButton articleIds={["a"]} />);
    await openDialog();
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" }).find((b) => b.closest("[role=alertdialog]"))!);
    await screen.findByText("Nope");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await openDialog();
    expect(screen.queryByText("Nope")).not.toBeInTheDocument();
  });
});
