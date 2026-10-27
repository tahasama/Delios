"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Building2, FolderKanban, Settings, Users } from "lucide-react";

/** Which pages each tab holds: the organization opens on Projects; Settings holds every card of how it works. */
const TABS = [
  { href: "/organization", label: "Projects", hint: "ours and joined", icon: FolderKanban, holds: ["/organization", "/organization/projects"] },
  { href: "/organization/people", label: "People", hint: "everyone with an account", icon: Users, holds: ["/organization/people"] },
  { href: "/organization/organizations", label: "Organizations", hint: "who we work with", icon: Building2, holds: ["/organization/organizations"] },
  { href: "/organization/settings", label: "Settings", hint: "how it works", icon: Settings, holds: ["/organization/settings", "/organization/defaults"] },
];

/**
 * The organization's four tabs, under its band (owner: tabs across the top, never a side menu taking the page's
 * width), drawn as the Schedule's views (`.views`): one frame, the side you are on lit.
 */
export function OrgTabs() {
  const path = usePathname();
  const on = (holds: string[]) => holds.some((h) => (h === "/organization" ? path === h : path === h || path.startsWith(`${h}/`)));
  return (
    <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
      <nav aria-label="The organization" className="views">
        {TABS.map((tab) => (
          <Link key={tab.href} href={tab.href} aria-current={on(tab.holds) ? "page" : undefined} className="view">
            <tab.icon />
            {tab.label}
            <span className="view-hint hidden xl:inline">· {tab.hint}</span>
            <ArrowRight className="view-go hidden sm:block" />
          </Link>
        ))}
      </nav>
    </div>
  );
}
