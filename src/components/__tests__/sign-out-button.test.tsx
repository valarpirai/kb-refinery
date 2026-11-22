// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SignOutButton } from ".././sign-out-button";

const replace = vi.fn();
const refresh = vi.fn();
const signOut = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: () => signOut() } }));

describe("SignOutButton", () => {
  it("signs out, then goes to the login page and refreshes", async () => {
    const order: string[] = [];
    signOut.mockImplementation(async () => { order.push("signOut"); });
    replace.mockImplementation(() => order.push("replace"));
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(replace).toHaveBeenCalledWith("/login");
    expect(order).toEqual(["signOut", "replace"]);
  });
});
