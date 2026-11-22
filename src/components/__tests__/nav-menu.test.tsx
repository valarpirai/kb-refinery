// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NavLink, NavMenu } from ".././nav-menu";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock(".././nav-menu.css", () => ({}));

const items = [{ href: "/articles", label: "Articles" }, { href: "/import", label: "Import" }];

describe("NavLink", () => {
  it("marks Home current only on the exact root path", () => {
    pathname = "/";
    const { rerender } = render(<NavLink item={{ href: "/", label: "Home" }} />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    pathname = "/chat";
    rerender(<NavLink item={{ href: "/", label: "Home" }} />);
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("marks a link current for its own page and pages under it, not for look-alikes", () => {
    const item = { href: "/chat", label: "Chat" };
    pathname = "/chat";
    const { rerender } = render(<NavLink item={item} />);
    expect(screen.getByRole("link")).toHaveAttribute("aria-current", "page");
    pathname = "/chat/123";
    rerender(<NavLink item={item} />);
    expect(screen.getByRole("link")).toHaveAttribute("aria-current", "page");
    pathname = "/chatter";
    rerender(<NavLink item={item} />);
    expect(screen.getByRole("link")).not.toHaveAttribute("aria-current");
  });
});

describe("NavMenu", () => {
  it("is closed at first and lists its links when clicked", async () => {
    pathname = "/jobs";
    render(<NavMenu label="Content" items={items} />);
    expect(screen.queryByRole("menuitem", { name: "Articles" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Content/ }));
    expect(await screen.findByRole("menuitem", { name: "Articles" })).toHaveAttribute("href", "/articles");
    expect(screen.getByRole("menuitem", { name: "Import" })).toHaveAttribute("href", "/import");
  });

  it("bolds the button and marks the entry when the current page is inside it", async () => {
    pathname = "/articles/42";
    render(<NavMenu label="Content" items={items} />);
    const button = screen.getByRole("button", { name: /Content/ });
    expect(button.className).toContain("font-semibold");
    await userEvent.click(button);
    expect(await screen.findByRole("menuitem", { name: "Articles" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("menuitem", { name: "Import" })).not.toHaveAttribute("aria-current");
  });

  it("does not bold the button when the current page is elsewhere", () => {
    pathname = "/chat";
    render(<NavMenu label="Content" items={items} />);
    expect(screen.getByRole("button", { name: /Content/ }).className).not.toContain("font-semibold");
  });
});
