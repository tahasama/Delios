"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/core/utils";

type Item = { href: string; label: string; exact?: boolean; away?: boolean };

/**
 * The organization's menu: the organization itself, then how it works (its Settings and each of their cards), then
 * its records. Settings → Sign-in and the audit trail open inside a project (they are the organization's, read there),
 * so they carry the arrow that says the page leaves this space.
 */
const GROUPS = (inProjects: boolean): { title: string; items: Item[] }[] => [
  {
    title: "Organization",
    items: [
      { href: "/organization", label: "Overview", exact: true },
      { href: "/organization/projects", label: "Projects" },
      { href: "/organization/organizations", label: "Organizations we work with" },
    ],
  },
  {
    title: "How it works",
    items: [
      { href: "/organization/settings", label: "Settings", exact: true },
      { href: "/organization/settings/types", label: "Types & sets" },
      { href: "/organization/settings/fields", label: "Forms & fields" },
      { href: "/organization/settings/numbering", label: "Numbering" },
      { href: "/organization/settings/revisions", label: "Revisions" },
      { href: "/organization/settings/routes", label: "Review routes" },
      { href: "/organization/settings/functions", label: "Functions & permissions" },
      { href: "/organization/settings/flow", label: "Control room" },
      { href: "/organization/defaults", label: "Defaults for new projects" },
    ],
  },
  ...(inProjects
    ? [{
      title: "Records",
      items: [
        { href: "/settings/security", label: "Sign-in & security", away: true },
        { href: "/settings/audit", label: "Audit trail", away: true },
      ],
    }]
    : []),
];

export function OrgNav({ inProjects }: { inProjects: boolean }) {
  const path = usePathname();
  const on = (item: Item) => (item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`));
  return (
    <nav aria-label="The organization" className="mb-4 lg:sticky lg:top-5 lg:mb-0">
      <div className="register register-sheet register-sheet-open scroll-quiet flex gap-4 overflow-x-auto px-3 py-3 lg:block lg:max-h-[calc(100dvh-7rem)] lg:space-y-4 lg:overflow-y-auto">
        {GROUPS(inProjects).map((group) => (
          <div key={group.title} className="shrink-0">
            <p className="stencil mb-1 px-2 text-slate-500">{group.title}</p>
            <ul className="flex gap-0.5 lg:block lg:space-y-0.5">
              {group.items.map((item) => {
                const here = on(item);
                const sub = item.href.startsWith("/organization/settings/") || item.href === "/organization/defaults";
                return (
                  <li key={item.href}>
                    <Link href={item.href} aria-current={here ? "page" : undefined}
                      className={cn(
                        "flex items-center justify-between gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-[13px] leading-5 transition-colors",
                        sub && "lg:pl-4",
                        here ? "bg-tint font-semibold text-brand-ink" : "text-slate-600 hover:bg-tint-soft hover:text-slate-900",
                      )}>
                      {item.label}
                      {item.away ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
