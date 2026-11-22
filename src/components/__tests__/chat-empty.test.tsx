// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatEmpty } from ".././chat-empty";

describe("ChatEmpty", () => {
  it("greets the person by first name", () => {
    render(<ChatEmpty name="  Ada Lovelace " onPick={() => {}} />);
    expect(screen.getByRole("heading", { name: "Hello, Ada" })).toBeInTheDocument();
  });

  it("falls back to there when the name is blank", () => {
    render(<ChatEmpty name="   " onPick={() => {}} />);
    expect(screen.getByRole("heading", { name: "Hello, there" })).toBeInTheDocument();
  });

  it("passes the suggestion text to onPick when clicked", async () => {
    const onPick = vi.fn();
    render(<ChatEmpty name="Ada" onPick={onPick} />);
    const chips = screen.getAllByRole("button");
    expect(chips).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: "How do I reset my VPN password?" }));
    expect(onPick).toHaveBeenCalledWith("How do I reset my VPN password?");
  });
});
