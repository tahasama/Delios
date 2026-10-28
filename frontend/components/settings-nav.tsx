"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Tags } from "lucide-react";
import { SETUP_ICON } from "@/app/(app)/settings/icons";
import { cn } from "@/lib/core/utils";

export type NavItem = { href: string; title: string; text?: string; group: string; icon?: string };

/**
 * Settings as a side menu (owner: "settings would be better as side menu, than cards"): the overview first, then every
 * page the person opens, by group, the one you are on lit as the main menu lights it. On a narrow screen the same
 * pages run as one strip above the page.
 */
export function SettingsNav({ home, items, groups, label }: { home: string; items: NavItem[]; groups: string[]; label: string }) {
  const path = usePathname() ?? "";
  const lit = items
    .filter((i) => path === i.href || path.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? (path === home ? home : null);
  const Row = ({ item }: { item: NavItem }) => {
    const Icon = item.href === home ? LayoutGrid : SETUP_ICON[item.icon ?? item.href] ?? Tags;
    const on = lit === item.href;
    return (
      <Link href={item.href} title={item.text} aria-current={on ? "page" : undefined}
        className={cn("flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
          on ? "bg-tint font-semibold text-slate-900 shadow-[inset_2px_0_0_0_var(--color-brand-ink)]" : "text-slate-600 hover:bg-tint-soft hover:text-slate-900")}>
        <Icon className={cn("h-4 w-4 shrink-0", on ? "text-brand-ink" : "text-slate-400")} aria-hidden="true" />
        <span className="truncate">{item.title}</span>
      </Link>
    );
  };
  const overview: NavItem = { href: home, title: "Overview", group: "" };
  return (
    <>
      <nav aria-label={label} className="register register-sheet sticky top-20 hidden max-h-[calc(100vh-6rem)] w-60 shrink-0 self-start overflow-y-auto p-2 lg:block">
        <Row item={overview} />
        {groups.map((group) => {
          const mine = items.filter((i) => i.group === group);
          if (!mine.length) return null;
          return (
            <div key={group} className="mt-3">
              <p className="stencil px-2.5 pb-1 text-slate-400">{group}</p>
              {mine.map((item) => <Row key={item.href} item={item} />)}
            </div>
          );
        })}
      </nav>
      <nav aria-label={label} className="strip strip-card mb-3 lg:hidden">
        {[overview, ...items].map((item) => (
          <Link key={item.href} href={item.href} aria-current={lit === item.href ? "page" : undefined} className="strip-tab">{item.title}</Link>
        ))}
      </nav>
    </>
  );
}
