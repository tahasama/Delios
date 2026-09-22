"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeftRight,
  BookOpen,
  Boxes,
  CalendarRange,
  ClipboardCheck,
  FilePlus2,
  FileText,
  FolderKanban,
  Import,
  LayoutDashboard,
  ListChecks,
  Menu,
  Network,
  Search,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Five jobs, then two doors.
 *
 * The old sidebar had twenty-eight destinations in four groups, arranged the
 * way the Standard is arranged — Assurance, Exposures, Pipeline, DMP
 * readiness. That is the document controller's mental model shown to everyone,
 * and almost nobody signing in has "review the conformance statement" as their
 * job.
 *
 * So: the five things people actually come here to do, everything else behind
 * "More", and configuration behind "Settings". Both doors are filtered by what
 * the person's function permits, so nobody is shown a list of things that will
 * refuse them.
 */

type NavItem = {
  href: string;
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  exclude?: string[];
  /** Hidden when false. Undefined means always shown. */
  when?: boolean;
};

export type NavPermissions = {
  canRead: boolean;
  canTransmit: boolean;
  canControl: boolean;
  canConfigure: boolean;
  canCreate: boolean;
};

function primaryNav(p: NavPermissions): NavItem[] {
  return (
    [
      { href: "/", label: "Home", description: "What is waiting on me", icon: LayoutDashboard, exact: true },
      { href: "/documents", label: "Documents", description: "The register", icon: FileText, when: p.canRead },
      {
        href: "/actions",
        label: "Schedule & actions",
        description: "What is needed, and when",
        icon: CalendarRange,
        exclude: ["/actions/schedules"],
      },
      {
        href: "/transmittals",
        label: "Transmittals",
        description: "Issue, receive, confirm",
        icon: ArrowLeftRight,
        when: p.canTransmit || p.canControl,
      },
    ] as NavItem[]
  ).filter((i) => i.when !== false);
}

function moreNav(p: NavPermissions): NavItem[] {
  return (
    [
      { href: "/reviews", label: "Reviews", icon: ClipboardCheck },
      { href: "/packages", label: "Packages", icon: FolderKanban },
      { href: "/assets", label: "Assets & tags", icon: Boxes },
      { href: "/reports", label: "Reports", icon: ListChecks, when: p.canControl },
      { href: "/conformance", label: "Assurance", icon: ShieldCheck, when: p.canControl },
      { href: "/import", label: "Import & export", icon: Import, when: p.canCreate || p.canControl },
    ] as NavItem[]
  ).filter((i) => i.when !== false);
}

function isActive(pathname: string, item: NavItem) {
  if (item.exclude?.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false;
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavLink({
  item,
  pathname,
  compact = false,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#d9a441]/70",
        compact ? "items-center gap-3 px-3 py-2" : "items-start gap-3 px-3 py-3",
        active ? "bg-surface text-brand-ink shadow-sm" : "text-slate-300 hover:bg-white/7 hover:text-white",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
          active ? "bg-tint text-brand-ink" : "bg-white/7 text-slate-300",
        )}
      >
        <item.icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-5">{item.label}</span>
        {!compact && item.description ? (
          <span className={cn("mt-0.5 block text-[11px] leading-4", active ? "text-slate-500" : "text-slate-500 group-hover:text-slate-400")}>
            {item.description}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function SidebarBody({ perms, onNavigate }: { perms: NavPermissions; onNavigate?: () => void }) {
  const pathname = usePathname();
  const primary = primaryNav(perms);
  const more = moreNav(perms);
  // Keep "More" open while the person is inside it, so they can see where they are.
  const insideMore = more.some((item) => isActive(pathname, item));

  return (
    <>
      <Link href="/" onClick={onNavigate} className="mb-6 flex items-center gap-3 px-2 text-white">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#d9a441] text-sm font-black text-[#102a43] shadow-sm">D</span>
        <span>
          <span className="block text-[15px] font-bold tracking-[0.08em]">DELIOS</span>
          <span className="block text-[11px] text-slate-400">Project information, controlled</span>
        </span>
      </Link>

      <nav className="scroll-thin flex-1 space-y-4 overflow-y-auto pr-1" aria-label="Primary navigation">
        <ul className="space-y-1">
          {primary.map((item) => (
            <li key={item.href}>
              <NavLink item={item} pathname={pathname} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>

        {more.length ? (
          <details open={insideMore} className="group/more">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 transition hover:text-slate-300">
              More
              <span className="ml-auto text-[10px] font-normal tracking-normal text-slate-600 group-open/more:hidden">{more.length}</span>
            </summary>
            <ul className="mt-1 space-y-0.5">
              {more.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} pathname={pathname} compact onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </nav>

      <div className="mt-4 space-y-2">
        {perms.canConfigure ? (
          <Link
            href="/admin"
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition",
              pathname.startsWith("/admin") ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white",
            )}
          >
            <Settings className="h-4 w-4" /> Settings
          </Link>
        ) : null}
        <Link
          href="/guide"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition",
            pathname.startsWith("/guide") ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white",
          )}
        >
          <BookOpen className="h-4 w-4" /> Help &amp; orientation
        </Link>

        {perms.canCreate ? (
          <Link
            href="/documents/new"
            onClick={onNavigate}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-[#d9a441] px-3 py-2.5 text-xs font-bold text-[#102a43] transition hover:bg-[#e4b654]"
          >
            <FilePlus2 className="h-3.5 w-3.5" /> Create document
          </Link>
        ) : null}
      </div>
    </>
  );
}

export function Sidebar({ perms }: { perms: NavPermissions }) {
  return (
    <aside className="palette-light no-print fixed inset-y-0 left-0 z-20 hidden w-[268px] flex-col border-r border-[#254663] bg-[#102a43] px-4 py-5 text-slate-200 lg:flex">
      <SidebarBody perms={perms} />
    </aside>
  );
}

/** The same navigation as a drawer, for widths where the sidebar does not fit. */
export function MobileNav({ perms }: { perms: NavPermissions }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="no-print grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-600 transition hover:bg-slate-100 lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open ? (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-900/50" />
          <div className="palette-light absolute inset-y-0 left-0 flex w-[268px] max-w-[85vw] flex-col bg-[#102a43] px-4 py-5 text-slate-200 shadow-2xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-4 grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarBody perms={perms} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}

export function SearchBox({ className }: { className?: string }) {
  return (
    <form action="/documents" className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        name="q"
        aria-label="Search documents"
        placeholder="Search by number, title or tag"
        className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#5e7f9d] focus:bg-surface focus:ring-3 focus:ring-[#5e7f9d]/10"
      />
    </form>
  );
}
