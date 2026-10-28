"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, CreditCard, Inbox, LayoutGrid, LifeBuoy, Megaphone, ScrollText, Scale, UsersRound } from "lucide-react";

const TABS = [
  { href: "/console", label: "Overview", icon: LayoutGrid },
  { href: "/console/organizations", label: "Organizations", icon: Building2 },
  { href: "/console/requests", label: "Requests", icon: Inbox },
  { href: "/console/payments", label: "Plans & payments", icon: CreditCard },
  { href: "/console/legal", label: "Legal", icon: Scale },
  { href: "/console/support", label: "Support", icon: LifeBuoy },
  { href: "/console/notices", label: "Notices", icon: Megaphone },
  { href: "/console/team", label: "Team", icon: UsersRound },
  { href: "/console/log", label: "Log", icon: ScrollText },
];

/** The console's tabs, on the tab strip, scrolling sideways when they do not fit. */
export function ConsoleTabs() {
  const path = usePathname();
  const on = (href: string) => (href === "/console" ? path === href : path === href || path.startsWith(`${href}/`));
  return (
    <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
      <nav aria-label="The console" className="strip strip-card strip-full">
        {TABS.map((tab) => (
          <Link key={tab.href} href={tab.href} aria-current={on(tab.href) ? "page" : undefined} className="strip-tab">
            <tab.icon />
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
