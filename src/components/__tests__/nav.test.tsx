// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/session";
import { Nav } from ".././nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock(".././nav-menu.css", () => ({}));
vi.mock(".././notification-center", () => ({ NotificationCenter: () => <span>notif-stub</span> }));
vi.mock(".././sign-out-button", () => ({ SignOutButton: () => <button type="button">Sign out</button> }));

const user = (role: "admin" | "user"): SessionUser => ({ id: "u", name: "Ada", email: "ada@x.io", role });

describe("Nav", () => {
  it("shows the brand, top links, menus and the signed-in name with email as tooltip", () => {
    render(<Nav user={user("user")} />);
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByText("KB Refinery")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute("href", "/chat");
    for (const m of ["Content", "Pipeline", "Agent"]) expect(screen.getByRole("button", { name: new RegExp(m) })).toBeInTheDocument();
    expect(screen.getByText("Ada")).toHaveAttribute("title", "ada@x.io");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("hides Traces from regular users", async () => {
    render(<Nav user={user("user")} />);
    await userEvent.click(screen.getByRole("button", { name: /Agent/ }));
    expect(await screen.findByRole("menuitem", { name: "Agents" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Traces" })).not.toBeInTheDocument();
  });

  it("shows Traces to admins", async () => {
    render(<Nav user={user("admin")} />);
    await userEvent.click(screen.getByRole("button", { name: /Agent/ }));
    expect(await screen.findByRole("menuitem", { name: "Traces" })).toHaveAttribute("href", "/traces");
  });
});
