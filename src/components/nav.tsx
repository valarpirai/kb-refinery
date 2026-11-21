import Link from "next/link";

const links = [
  { href: "/", label: "Home" },
  { href: "/chat", label: "Chat" },
  { href: "/jobs", label: "Jobs" },
  { href: "/import", label: "Import" },
  { href: "/integrations", label: "Integrations" },
];

/** Top navigation bar shared by every page. */
export function Nav() {
  return (
    <header className="border-b border-black/10 dark:border-white/15">
      <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <span className="font-semibold">KB Refinery</span>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="text-sm hover:underline">
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
