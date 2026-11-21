import { NavLink, NavMenu } from "@/components/nav-menu";
import { NotificationCenter } from "@/components/notification-center";
import { SignOutButton } from "@/components/sign-out-button";
import type { SessionUser } from "@/lib/session";

const home = { href: "/", label: "Home" };
const chat = { href: "/chat", label: "Chat" };

/** Menus for the top bar. Traces is for admins only. */
function menus(admin: boolean) {
  return [
    { label: "Content", items: [{ href: "/articles", label: "Articles" }, { href: "/import", label: "Import" }, { href: "/integrations", label: "Integrations" }] },
    { label: "Pipeline", items: [{ href: "/jobs", label: "Jobs" }, { href: "/metrics", label: "Pipeline metrics" }] },
    { label: "Agent", items: [{ href: "/agents", label: "Agents" }, { href: "/agent-usage", label: "Agent usage" }, ...(admin ? [{ href: "/traces", label: "Traces" }] : [])] },
  ];
}

/** Top navigation bar shared by every signed-in page. */
export function Nav({ user }: { user: SessionUser }) {
  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span className="font-semibold">KB Refinery</span>
        <NavLink item={home} />
        <NavLink item={chat} />
        {menus(user.role === "admin").map((m) => (
          <NavMenu key={m.label} label={m.label} items={m.items} />
        ))}
        <span className="ml-auto flex items-center gap-3 text-sm">
          <NotificationCenter />
          <span className="opacity-70" title={user.email}>{user.name}</span>
          <SignOutButton />
        </span>
      </nav>
    </header>
  );
}
