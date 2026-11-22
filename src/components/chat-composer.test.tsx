// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { ChatComposer } from "./chat-composer";

/**
 * Render the composer with defaults.
 * @param over props to override
 */
function setup(over: Partial<React.ComponentProps<typeof ChatComposer>> = {}) {
  const props = { query: "hello there", onQuery: vi.fn(), onSend: vi.fn(), busy: false, error: null, inputRef: createRef<HTMLTextAreaElement>(), ...over };
  render(<ChatComposer {...props} />);
  return props;
}

describe("ChatComposer", () => {
  it("shows the query and attaches the input ref", () => {
    const p = setup();
    expect(screen.getByLabelText("Ask a question")).toHaveValue("hello there");
    expect(p.inputRef.current).toBe(screen.getByLabelText("Ask a question"));
  });

  it("reports typing through onQuery", async () => {
    const p = setup({ query: "" });
    await userEvent.type(screen.getByLabelText("Ask a question"), "a");
    expect(p.onQuery).toHaveBeenCalledWith("a");
  });

  it("sends on Enter", async () => {
    const p = setup();
    await userEvent.type(screen.getByLabelText("Ask a question"), "{Enter}");
    expect(p.onSend).toHaveBeenCalledTimes(1);
  });

  it("does not send on Shift+Enter", async () => {
    const p = setup();
    await userEvent.type(screen.getByLabelText("Ask a question"), "{Shift>}{Enter}{/Shift}");
    expect(p.onSend).not.toHaveBeenCalled();
  });

  it("sends when the send button is clicked", async () => {
    const p = setup();
    await userEvent.click(screen.getByRole("button", { name: "Send question" }));
    expect(p.onSend).toHaveBeenCalledTimes(1);
  });

  it("will not send fewer than 3 characters", async () => {
    const p = setup({ query: "  hi " });
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Ask a question"), "{Enter}");
    expect(p.onSend).not.toHaveBeenCalled();
  });

  it("will not send while busy", async () => {
    const p = setup({ busy: true });
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Ask a question"), "{Enter}");
    expect(p.onSend).not.toHaveBeenCalled();
  });

  it("shows an error", () => {
    setup({ error: "Too many requests" });
    expect(screen.getByRole("alert")).toHaveTextContent("Too many requests");
  });
});
