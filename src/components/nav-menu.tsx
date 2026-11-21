"use client";

import { Menu } from "@base-ui/react/menu";
import Link from "next/link";
import { usePathname } from "next/navigation";
import "./nav-menu.css";

export interface NavItem {
  href: string;
  label: string;
}

/**
 * Whether a path belongs to a menu entry.
 * @param pathname the current path
 * @param href the entry's path
 * @return true when the entry is the current page or a parent of it
 */
function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

const triggerClass =
  "inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-sm hover:bg-black/5 data-[popup-open]:bg-black/10 dark:hover:bg-white/10 dark:data-[popup-open]:bg-white/15";

/** A single top-level link. */
export function NavLink({ item }: { item: NavItem }) {
  const current = isCurrent(usePathname(), item.href);
  return (
    <Link href={item.href} aria-current={current ? "page" : undefined} className={`cursor-pointer rounded px-2 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/10 ${current ? "font-semibold" : ""}`}>
      {item.label}
    </Link>
  );
}

/**
 * A top-level menu that opens a list of links.
 * The button is marked when the current page is one of its entries.
 */
export function NavMenu({ label, items }: { label: string; items: NavItem[] }) {
  const pathname = usePathname();
  const hasCurrent = items.some((i) => isCurrent(pathname, i.href));
  return (
    <Menu.Root>
      <Menu.Trigger openOnHover delay={80} closeDelay={150} className={`${triggerClass} ${hasCurrent ? "font-semibold" : ""}`}>
        {label}
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" className="opacity-60">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="nav-menu-positioner" side="bottom" align="start" sideOffset={6}>
          <Menu.Popup className="nav-menu-popup min-w-44 rounded-lg border border-black/10 bg-white p-1 text-sm text-black shadow-lg dark:border-white/15 dark:bg-neutral-900 dark:text-white">
            {items.map((i) => (
              <Menu.LinkItem
                key={i.href}
                href={i.href}
                render={<Link href={i.href} />}
                aria-current={isCurrent(pathname, i.href) ? "page" : undefined}
                className="block cursor-pointer rounded px-3 py-1.5 outline-none data-[highlighted]:bg-black/10 aria-[current=page]:font-semibold dark:data-[highlighted]:bg-white/15"
              >
                {i.label}
              </Menu.LinkItem>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
