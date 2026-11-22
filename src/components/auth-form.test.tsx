// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthForm } from "./auth-form";

const replace = vi.fn();
const refresh = vi.fn();
const signIn = vi.fn();
const signUp = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: (...a: unknown[]) => signIn(...a) }, signUp: { email: (...a: unknown[]) => signUp(...a) } },
}));

describe("AuthForm", () => {
  it("login shows email and password only, with a link to sign up", () => {
    render(<AuthForm mode="login" />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/signup");
  });

  it("signup shows the name field, the password hint and a link back to login", () => {
    render(<AuthForm mode="signup" />);
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByText("At least 8 characters.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("hides the switch link when sign up is closed", () => {
    render(<AuthForm mode="login" canSignUp={false} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("signs in with trimmed email, then goes home and refreshes", async () => {
    signIn.mockResolvedValue({ error: null });
    render(<AuthForm mode="login" />);
    await userEvent.type(screen.getByLabelText("Email"), "  a@b.co ");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(signIn).toHaveBeenCalledWith({ email: "a@b.co", password: "secret123" });
    expect(refresh).toHaveBeenCalled();
  });

  it("signs up with name, email and password", async () => {
    signUp.mockResolvedValue({ error: null });
    render(<AuthForm mode="signup" />);
    await userEvent.type(screen.getByLabelText("Name"), " Ada ");
    await userEvent.type(screen.getByLabelText("Email"), "ada@x.io");
    await userEvent.type(screen.getByLabelText("Password"), "longenough");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(signUp).toHaveBeenCalledWith({ name: "Ada", email: "ada@x.io", password: "longenough" });
  });

  it("shows the error and stays on the page when sign in fails", async () => {
    signIn.mockResolvedValue({ error: { message: "Invalid credentials" } });
    render(<AuthForm mode="login" />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "wrongpass1");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("uses a generic message when the error has none", async () => {
    signIn.mockResolvedValue({ error: {} });
    render(<AuthForm mode="login" />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "wrongpass1");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("disables the button while waiting", async () => {
    signIn.mockReturnValue(new Promise(() => {}));
    render(<AuthForm mode="login" />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("button", { name: "Please wait…" })).toBeDisabled();
  });
});
