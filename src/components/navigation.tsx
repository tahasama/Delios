"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  PanelLeftClose,
  PanelLeftOpen,
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
  /** Other paths of the same section, so a tab strip does not unlight the item. */
  also?: string[];
  /** Hidden when false. Undefined means always shown. */
  when?: boolean;
};

export type NavPermissions = {
  canRead: boolean;
  canTransmit: boolean;
  canControl: boolean;
  canConfigure: boolean;
  canCreate: boolean;
  /** Someone from another organization: the menu holds only what concerns them. */
  external?: boolean;
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
        // An outside reader always has the transmittals addressed to them.
        when: p.canTransmit || p.canControl || p.external,
      },
    ] as NavItem[]
  ).filter((i) => i.when !== false);
}

function moreNav(p: NavPermissions): NavItem[] {
  return (
    [
      { href: "/reviews", label: "Reviews", icon: ClipboardCheck },
      { href: "/packages", label: "Packages", icon: FolderKanban },
      { href: "/assets", label: "Assets & tags", icon: Boxes, when: !p.external },
      { href: "/distribution", label: "Distribution matrix", icon: Network, when: p.canRead && !p.external },
      { href: "/reports", label: "Reports", icon: ListChecks, when: p.canControl && !p.external },
      { href: "/conformance/checks", label: "Assurance", icon: ShieldCheck, also: ["/conformance", "/exposures"], when: p.canControl && !p.external },
      { href: "/import", label: "Import & export", icon: Import, when: (p.canControl || p.canConfigure) && !p.external },
    ] as NavItem[]
  ).filter((i) => i.when !== false);
}

function isActive(pathname: string, item: NavItem) {
  if (item.exclude?.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false;
  if (item.also?.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return true;
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/* Sidebar width. The desktop sidebar can be dragged wider or narrower. Below
   railBelow it snaps to an icon rail, where labels show as tooltips. The width
   lives in a CSS variable on <html>, set before first paint by THEME_SCRIPT, so
   the layout never jumps. */
export const SIDEBAR = { default: 268, rail: 76, min: 76, max: 360, railBelow: 180 } as const;

function setSidebarWidth(w: number, persist: boolean) {
  const root = document.documentElement;
  root.style.setProperty("--sidebar-w", `${w}px`);
  if (w < SIDEBAR.railBelow) root.dataset.sidebar = "rail";
  else delete root.dataset.sidebar;
  if (persist) {
    try { localStorage.setItem("sidebar", String(w)); } catch {}
  }
}
const isRail = () => typeof document !== "undefined" && document.documentElement.dataset.sidebar === "rail";

type Tip = { label: string; top: number } | null;

function tipFor(e: React.MouseEvent<HTMLElement>, label: string, onTip?: (t: Tip) => void) {
  if (!onTip || !isRail()) return;
  const r = e.currentTarget.getBoundingClientRect();
  onTip({ label, top: r.top + r.height / 2 });
}

function NavLink({
  item,
  pathname,
  compact = false,
  onNavigate,
  onTip,
}: {
  item: NavItem;
  pathname: string;
  compact?: boolean;
  onNavigate?: () => void;
  onTip?: (t: Tip) => void;
}) {
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      onMouseEnter={(e) => tipFor(e, item.label, onTip)}
      onMouseLeave={() => onTip?.(null)}
      className={cn(
        "group flex rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#d9a441]/70 rail:justify-center rail:px-0",
        compact ? "items-center gap-3 px-3 py-2" : "items-start gap-3 px-3 py-3 rail:py-1.5",
        active
          ? "bg-surface text-brand-ink shadow-sm dark:bg-white/10 dark:text-white dark:shadow-none"
          : "text-slate-300 hover:bg-white/7 hover:text-white",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg rail:mt-0",
          active ? "bg-tint text-brand-ink dark:bg-[#d9a441]/20 dark:text-[#e4b654]" : "bg-white/7 text-slate-300",
        )}
      >
        <item.icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 rail:hidden">
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

function SidebarBody({ perms, onNavigate, onTip }: { perms: NavPermissions; onNavigate?: () => void; onTip?: (t: Tip) => void }) {
  const pathname = usePathname();
  const primary = primaryNav(perms);
  const more = moreNav(perms);
  // Keep "More" open while the person is inside it, so they can see where they are.
  const insideMore = more.some((item) => isActive(pathname, item));

  return (
    <>
      <Link href="/" onClick={onNavigate} className="mb-6 flex items-center gap-3 px-2 text-white rail:justify-center rail:px-0">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#d9a441] text-sm font-black text-[#102a43] shadow-sm">D</span>
        <span className="rail:hidden">
          <span className="block text-[15px] font-bold tracking-[0.08em]">DELIOS</span>
          <span className="block text-[11px] text-slate-400">Project information, controlled</span>
        </span>
      </Link>

      <nav className="scroll-thin flex-1 space-y-4 overflow-y-auto overflow-x-hidden pr-1 rail:pr-0" aria-label="Primary navigation">
        <ul className="space-y-1">
          {primary.map((item) => (
            <li key={item.href}>
              <NavLink item={item} pathname={pathname} onNavigate={onNavigate} onTip={onTip} />
            </li>
          ))}
        </ul>

        {more.length ? (
          <details open={insideMore} className="group/more">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 transition hover:text-slate-300 rail:justify-center rail:px-0">
              <span className="rail:hidden">More</span>
              <span aria-hidden className="hidden w-6 border-t border-white/20 rail:block" />
              <span className="ml-auto text-[10px] font-normal tracking-normal text-slate-600 group-open/more:hidden rail:hidden">{more.length}</span>
            </summary>
            <ul className="mt-1 space-y-0.5">
              {more.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} pathname={pathname} compact onNavigate={onNavigate} onTip={onTip} />
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
            aria-label="Settings"
            onMouseEnter={(e) => tipFor(e, "Settings", onTip)}
            onMouseLeave={() => onTip?.(null)}
            className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition rail:justify-center rail:px-0",
              pathname.startsWith("/admin") ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white",
            )}
          >
            <Settings className="h-4 w-4 shrink-0" /> <span className="rail:hidden">Settings</span>
          </Link>
        ) : null}
        <Link
          href="/guide"
          onClick={onNavigate}
          aria-label="Help and orientation"
          onMouseEnter={(e) => tipFor(e, "Help & orientation", onTip)}
          onMouseLeave={() => onTip?.(null)}
          className={cn(
            "flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition rail:justify-center rail:px-0",
            pathname.startsWith("/guide") ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white",
          )}
        >
          <BookOpen className="h-4 w-4 shrink-0" /> <span className="rail:hidden">Help &amp; orientation</span>
        </Link>

        {perms.canCreate ? (
          <Link
            href="/documents/new"
            onClick={onNavigate}
            aria-label="Create document"
            onMouseEnter={(e) => tipFor(e, "Create document", onTip)}
            onMouseLeave={() => onTip?.(null)}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-[#d9a441] px-3 py-2.5 text-xs font-bold text-[#102a43] transition hover:bg-[#e4b654] rail:px-0"
          >
            <FilePlus2 className="h-3.5 w-3.5 shrink-0" /> <span className="rail:hidden">Create document</span>
          </Link>
        ) : null}
      </div>
    </>
  );
}

export function Sidebar({ perms }: { perms: NavPermissions }) {
  const [tip, setTip] = useState<Tip>(null);
  const [rail, setRail] = useState(false);
  const dragging = useRef(false);

  useEffect(() => setRail(isRail()), []);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    setTip(null);
    document.body.classList.add("dt-resizing");
    let w = document.querySelector<HTMLElement>(".sidebar-desktop")?.getBoundingClientRect().width ?? SIDEBAR.default;
    const move = (ev: PointerEvent) => {
      w = Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, Math.round(ev.clientX)));
      setSidebarWidth(w, false);
      setRail(w < SIDEBAR.railBelow);
    };
    const up = () => {
      dragging.current = false;
      document.body.classList.remove("dt-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // Between the rail and a readable width there is nothing useful: snap.
      const final = w < SIDEBAR.railBelow ? SIDEBAR.rail : w;
      setSidebarWidth(final, true);
      setRail(final < SIDEBAR.railBelow);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const toggle = () => {
    const next = rail ? SIDEBAR.default : SIDEBAR.rail;
    setSidebarWidth(next, true);
    setRail(!rail);
    setTip(null);
  };

  return (
    <aside
      className="sidebar-desktop palette-light no-print fixed inset-y-0 left-0 z-20 hidden w-67 flex-col border-r border-[#254663] bg-[#102a43] px-4 py-5 text-slate-200 lg:flex rail:px-2.5 dark:border-white/5 dark:bg-[#0c1522]"
      style={{ width: "var(--sidebar-w)" }}
    >
      <SidebarBody perms={perms} onTip={(t) => { if (!dragging.current) setTip(t); }} />
      <button
        type="button"
        onClick={toggle}
        aria-label={rail ? "Expand the menu" : "Collapse the menu to icons"}
        onMouseEnter={(e) => tipFor(e, "Expand the menu", setTip)}
        onMouseLeave={() => setTip(null)}
        className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold text-slate-500 transition hover:bg-white/5 hover:text-slate-200 rail:justify-center rail:px-0"
      >
        {rail ? <PanelLeftOpen className="h-4 w-4 shrink-0" /> : <PanelLeftClose className="h-4 w-4 shrink-0" />}
        <span className="rail:hidden">Collapse menu</span>
      </button>
      {/* Drag to resize; double-click to switch between icons and full width. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the menu"
        title="Drag to resize. Double-click to collapse or expand."
        onPointerDown={onPointerDown}
        onDoubleClick={toggle}
        className="group/resize absolute inset-y-0 -right-1.5 z-30 w-3 cursor-col-resize"
      >
        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition group-hover/resize:bg-[#d9a441]/80" />
      </div>
      {tip ? (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-lg bg-[#0b1726] px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg ring-1 ring-white/10"
          style={{ top: tip.top, left: "calc(var(--sidebar-w) + 10px)" }}
        >
          {tip.label}
        </span>
      ) : null}
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
          <div className="palette-light absolute inset-y-0 left-0 flex w-67 max-w-[85vw] flex-col bg-[#102a43] px-4 py-5 text-slate-200 shadow-2xl">
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
        className="h-10 w-full rounded-xl border border-line bg-slate-50 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#5e7f9d] focus:bg-surface focus:ring-3 focus:ring-[#5e7f9d]/10"
      />
    </form>
  );
}
