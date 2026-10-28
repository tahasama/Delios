"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, LayoutGrid, Tags } from "lucide-react";
import { SETUP_ICON } from "@/app/(app)/settings/icons";
import { cn } from "@/lib/core/utils";

export type NavItem = { href: string; title: string; text?: string; group: string; icon?: string };
type Props = { home: string; items: NavItem[]; groups: string[]; label: string; mode: "column" | "switcher"; top: "bar" | "none" };

/**
 * Settings as a side menu (owner: "settings would be better as side menu, than cards"): the overview first, then every
 * page the person opens, by group, the one you are on lit, standing in place the window's full height. Never a third
 * column (owner: "ended up with 3 side menus, back to back and few space for actual thing"): on a page that has a side
 * menu of its own (the logbooks, Types & sets, Forms & fields), and on a narrower window, it is one button above the
 * page instead, "Settings · <page>", opening the same list.
 */
export function SettingsNav({ home, items, groups, label, mode, top }: Props) {
  const path = usePathname() ?? "";
  const lit = items
    .filter((i) => path === i.href || path.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0] ?? null;
  const ownMenu = OWN_MENU.some((one) => path === one || path.startsWith(`${one}/`) || (one.endsWith("/") && path.startsWith(one)));
  const overview: NavItem = { href: home, title: "Overview", group: "" };
  const litHref = lit?.href ?? (path === home ? home : null);

  const Row = ({ item }: { item: NavItem }) => {
    const Icon = item.href === home ? LayoutGrid : SETUP_ICON[item.icon ?? item.href] ?? Tags;
    const on = litHref === item.href;
    return (
      <Link href={item.href} title={item.text} aria-current={on ? "page" : undefined}
        className={cn("flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
          on ? "bg-tint font-semibold text-slate-900 shadow-[inset_2px_0_0_0_var(--color-brand-ink)]" : "text-slate-600 hover:bg-tint-soft hover:text-slate-900")}>
        <Icon className={cn("h-4 w-4 shrink-0", on ? "text-brand-ink" : "text-slate-400")} aria-hidden="true" />
        <span className="truncate">{item.title}</span>
      </Link>
    );
  };
  const list = (
    <>
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
    </>
  );

  if (mode === "column") {
    if (ownMenu) return null;
    return (
      <nav aria-label={label}
        className={cn("register register-sheet sticky hidden w-56 shrink-0 self-start overflow-y-auto p-2 scroll-thin min-[1440px]:block",
          top === "bar" ? "top-20 h-[calc(100vh-6rem)]" : "top-4 h-[calc(100vh-2rem)]")}>
        {list}
      </nav>
    );
  }
  // The switcher: always on a page with its own side menu; below the width where the column shows, everywhere.
  return (
    <details data-menu className={cn("group relative w-fit", ownMenu ? "" : "min-[1440px]:hidden")}>
      <summary className="ask cursor-pointer list-none [&::-webkit-details-marker]:hidden" aria-label={`${label}: go to another page`}>
        <span className="text-slate-500">Settings</span>
        <span aria-hidden className="text-slate-300">·</span>
        <span className="font-semibold text-slate-900">{lit?.title ?? "Overview"}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-500 transition group-open:rotate-180" />
      </summary>
      <nav aria-label={label} className="register register-sheet absolute left-0 top-full z-30 mt-1 max-h-[70vh] w-64 overflow-y-auto p-2 scroll-thin shadow-lg">
        {list}
      </nav>
    </details>
  );
}

/** The pages that carry a side menu of their own: the Settings menu becomes the switcher there. */
const OWN_MENU = ["/settings/audit", "/settings/users/", "/settings/config", "/settings/fields", "/organization/settings/types", "/organization/settings/fields"];
