"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Which pages each tab holds: the organization opens on Projects; Settings holds every card of how it works. */
const TABS = [
  { href: "/organization", label: "Projects", holds: ["/organization", "/organization/projects"] },
  { href: "/organization/people", label: "People", holds: ["/organization/people"] },
  { href: "/organization/organizations", label: "Organizations", holds: ["/organization/organizations"] },
  { href: "/organization/settings", label: "Settings", holds: ["/organization/settings", "/organization/defaults"] },
];

/** The organization's four tabs, under its band (owner: tabs across the top, never a side menu taking the page's width). */
export function OrgTabs() {
  const path = usePathname();
  const on = (holds: string[]) => holds.some((h) => (h === "/organization" ? path === h : path === h || path.startsWith(`${h}/`)));
  return (
    <nav aria-label="The organization" className="border-b border-line bg-surface">
      <ul className="tabs mx-auto max-w-7xl border-b-0 px-4 pt-1 sm:px-6">
        {TABS.map((tab) => {
          const here = on(tab.holds);
          return (
            <li key={tab.href}>
              <Link href={tab.href} aria-current={here ? "page" : undefined}
                className="tab">
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
