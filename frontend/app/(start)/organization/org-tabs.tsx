"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/core/utils";

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
      <ul className="scroll-quiet mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6">
        {TABS.map((tab) => {
          const here = on(tab.holds);
          return (
            <li key={tab.href}>
              <Link href={tab.href} aria-current={here ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-center border-b-2 px-3 py-2.5 text-[13px] whitespace-nowrap transition-colors",
                  here ? "border-brand-ink font-semibold text-brand-ink" : "border-transparent text-slate-600 hover:border-line-strong hover:text-slate-900",
                )}>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
