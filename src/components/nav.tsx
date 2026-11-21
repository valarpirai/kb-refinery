import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import type { SessionUser } from "@/lib/session";

const links = [
  { href: "/", label: "Home" },
  { href: "/articles", label: "Articles" },
  { href: "/chat", label: "Chat" },
  { href: "/jobs", label: "Jobs" },
  { href: "/import", label: "Import" },
  { href: "/integrations", label: "Integrations" },
];

/** Top navigation bar shared by every signed-in page. */
export function Nav({ user }: { user: SessionUser }) {
  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <span className="font-semibold">KB Refinery</span>
        {(user.role === "admin" ? [...links, { href: "/traces", label: "Traces" }] : links).map((l) => (
          <Link key={l.href} href={l.href} className="text-sm hover:underline">
            {l.label}
          </Link>
        ))}
        <span className="ml-auto flex items-center gap-3 text-sm">
          <span className="opacity-70" title={user.email}>{user.name}</span>
          <SignOutButton />
        </span>
      </nav>
    </header>
  );
}
