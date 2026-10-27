"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Boxes,
  CalendarRange,
  ClipboardCheck,
  FileText,
  FolderKanban,
  Import,
  LayoutDashboard,
  ListChecks,
  Menu,
  Minus,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Network,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/core/utils";
import { PREF, savePreference } from "@/lib/core/preferences";

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

type NavPermissions = {
  canRead: boolean;
  canTransmit: boolean;
  canControl: boolean;
  canConfigure: boolean;
  /** At least one Settings page opens for this person (`SETUP_PAGES`, `maySetup`): the Settings link shows exactly then. */
  canSettings: boolean;
  canCreate: boolean;
  /** Someone from another organization: the menu holds only what concerns them. */
  external?: boolean;
};

function primaryNav(p: NavPermissions): NavItem[] {
  return (
    [
      { href: "/", label: "Home", description: "What is waiting on me", icon: LayoutDashboard, exact: true },
      { href: "/documents", label: "Documents", description: "The register", icon: FileText, when: p.canRead },
      // The same entry and the same page for everyone, narrowed to what is theirs.
      { href: "/schedule", label: "Schedule", description: "What is needed, and when", icon: CalendarRange, also: ["/needed", "/actions"] },
      {
        href: "/transmittals",
        label: "Transmittals",
        description: "Issue, receive, confirm",
        icon: ArrowLeftRight,
        // An outside reader always has the transmittals addressed to them.
        when: p.canTransmit || p.canControl || p.external,
      },
      // Daily work too, so above "+ More" (owner).
      { href: "/reviews", label: "Reviews", description: "Advise, decide, follow", icon: ClipboardCheck },
      { href: "/packages", label: "Packages", description: "What goes and comes together", icon: FolderKanban },
    ] as NavItem[]
  ).filter((i) => i.when !== false);
}

function moreNav(p: NavPermissions): NavItem[] {
  return (
    [
      { href: "/assets", label: "Assets & tags", icon: Boxes, when: !p.external },
      { href: "/distribution", label: "Distribution matrix", icon: Network, when: p.canRead && !p.external },
      { href: "/reports", label: "Reports", icon: ListChecks, when: p.canRead },
      // Everyone on the project reads who takes part.
      { href: "/directory", label: "Project directory", icon: UsersRound, also: ["/people/ask"] },
      { href: "/conformance/checks", label: "Assurance", icon: ShieldCheck, also: ["/conformance", "/exposures"], when: p.canControl && !p.external },
      { href: "/import", label: "Import & export", icon: Import, when: (p.canControl || p.canConfigure || p.canCreate) && !p.external },
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
   lives in a CSS variable on <html> and in a cookie, which the server reads to
   send every page at that width (app/layout.tsx), so the layout never jumps. */
const SIDEBAR = { default: 268, rail: 76, min: 76, max: 360, railBelow: 180 } as const;

function setSidebarWidth(w: number, persist: boolean) {
  const root = document.documentElement;
  root.style.setProperty("--sidebar-w", `${w}px`);
  if (w < SIDEBAR.railBelow) root.dataset.sidebar = "rail";
  else delete root.dataset.sidebar;
  if (persist) {
    savePreference(PREF.sidebar, String(w));
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
        // One row per entry, the same height folded or open; the page you are on is a light row, its icon as any other.
        "group flex rounded-lg outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-gold/70 rail:justify-center rail:px-0",
        compact ? "items-center gap-3 px-2 py-1 tiny:py-0.5" : "items-start gap-3 px-2 py-2 short:items-center short:py-1 rail:py-1",
        active ? "bg-white/12 text-white" : "text-slate-300 hover:bg-white/6 hover:text-white",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors rail:mt-0 short:mt-0",
          active ? "text-white" : "text-slate-400 group-hover:text-white",
        )}
      >
        <item.icon className="h-4.5 w-4.5" />
      </span>
      <span className="min-w-0 rail:hidden">
        <span className={cn("block text-sm leading-5", active ? "font-semibold" : "font-medium")}>{item.label}</span>
        {!compact && item.description ? (
          <span className={cn("block text-[11px] leading-4 short:hidden", active ? "text-slate-300" : "text-slate-400 group-hover:text-slate-300")}>
            {item.description}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function SidebarBody({ perms, moreOpen, onNavigate, onTip, drawer = false }: {
  perms: NavPermissions;
  /** Whether "More" was left open (its cookie, read by the server). */
  moreOpen: boolean;
  onNavigate?: () => void;
  onTip?: (t: Tip) => void;
  /** The phone's drawer: room for its close button, and the search under the mark. */
  drawer?: boolean;
}) {
  const pathname = usePathname();
  const primary = primaryNav(perms);
  const more = moreNav(perms);
  // Open while the person is inside it, so they can see where they are; else as they left it.
  const insideMore = more.some((item) => isActive(pathname, item));
  const [open, setOpen] = useState(moreOpen || insideMore);
  useEffect(() => { if (insideMore) setOpen(true); }, [insideMore]);
  const moreLabel = open ? "Fewer entries" : `${more.length} more entries`;

  return (
    <>
      {/* The mark, as tall as the top bar and closed by the same line, so the two bars read as one frame. */}
      <div className={cn("-mx-4 flex h-16 shrink-0 items-center border-b border-white/8 px-4 rail:-mx-2.5 rail:justify-center rail:px-0", drawer && "pr-12")}>
        <Link href="/" onClick={onNavigate} className="flex min-w-0 items-center gap-3 rounded-lg px-1 text-white outline-none focus-visible:ring-2 focus-visible:ring-gold/70 rail:px-0">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gold text-sm font-black text-[#102a43]">D</span>
          <span className="min-w-0 rail:hidden">
            <span className="block text-[15px] font-bold leading-5 tracking-[0.08em]">DELIOS</span>
            <span className="block truncate text-[11px] leading-4 text-slate-400">Project information, controlled</span>
          </span>
        </Link>
      </div>

      {drawer ? <SearchBox className="mt-3" dark onSearch={onNavigate} /> : null}

      {/* Never scrolled (owner): everything is laid out to fit the window; scrolling is only a last resort on a very small screen. */}
      <nav className="scroll-thin -mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-1 pt-4 short:pt-3" aria-label="Primary navigation">
        <ul className="space-y-0.5">
          {primary.map((item) => (
            <li key={item.href}>
              <NavLink item={item} pathname={pathname} onNavigate={onNavigate} onTip={onTip} />
            </li>
          ))}
        </ul>

        {more.length ? (
          <details open={open} className="group/more">
            {/* A small "+ More" taking almost no room (owner), remembered as it was left (cookie, read by the server). */}
            <summary
              aria-label={moreLabel}
              onClick={(e) => {
                e.preventDefault();
                setOpen(!open);
                savePreference(PREF.navMore, open ? "0" : "1");
                onTip?.(null);
              }}
              onMouseEnter={(e) => tipFor(e, moreLabel, onTip)}
              onMouseLeave={() => onTip?.(null)}
              className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium text-slate-400 outline-none transition hover:text-white focus-visible:ring-2 focus-visible:ring-gold/70 rail:justify-center rail:px-0 rail:py-1"
            >
              {open ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              <span className="rail:hidden">{open ? "Less" : "More"}</span>
            </summary>
            <ul className="mt-0.5 space-y-0.5">
              {more.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} pathname={pathname} compact onNavigate={onNavigate} onTip={onTip} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </nav>

    </>
  );
}

export function Sidebar({ perms, moreOpen }: { perms: NavPermissions; moreOpen: boolean }) {
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
      className="sidebar-desktop palette-light no-print fixed inset-y-0 left-0 z-20 hidden w-67 flex-col border-r border-[#254663] bg-[#102a43] px-4 pb-4 text-slate-200 short:pb-3 lg:flex rail:px-2.5 dark:border-white/5 dark:bg-[#0c1522]"
      style={{ width: "var(--sidebar-w)" }}
    >
      <SidebarBody perms={perms} moreOpen={moreOpen} onTip={(t) => { if (!dragging.current) setTip(t); }} />
      {/* Folding to icons sits on the menu's edge, taking no room in it (owner). */}
      <button
        type="button"
        onClick={toggle}
        aria-label={rail ? "Expand the menu" : "Fold the menu to icons"}
        title={rail ? "Expand the menu" : "Fold the menu to icons"}
        className="absolute top-16 -right-3 z-40 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-slate-500 shadow-[0_1px_3px_rgb(16_42_67/0.18)] transition hover:border-line-strong hover:text-brand-ink focus-visible:ring-2 focus-visible:ring-gold/70 outline-none"
      >
        {rail ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
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
        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition group-hover/resize:bg-gold/80" />
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
export function MobileNav({ perms, moreOpen }: { perms: NavPermissions; moreOpen: boolean }) {
  const [open, setOpen] = useState(false);
  // Escape closes it, as a picked entry and a click beside it do.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
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
          <div className="palette-light absolute inset-y-0 left-0 flex w-67 max-w-[85vw] flex-col bg-[#102a43] px-4 pb-4 text-slate-200 shadow-2xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-4 z-10 grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarBody perms={perms} moreOpen={moreOpen} drawer onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}

export function SearchBox({ className, dark = false, onSearch }: {
  className?: string;
  /** On the menu's navy (the phone's drawer). */
  dark?: boolean;
  onSearch?: () => void;
}) {
  return (
    <form action="/documents" onSubmit={onSearch} className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        name="q"
        aria-label="Search documents"
        placeholder="Search by number, title or tag"
        className={cn(
          "h-(--control-h) w-full rounded-(--control-radius) border pl-9 pr-3 text-(length:--control-text) outline-none transition",
          dark
            ? "border-white/12 bg-white/8 text-white placeholder:text-slate-400 focus:border-white/30 focus:bg-white/12"
            : "border-line bg-slate-50 text-slate-800 placeholder:text-slate-500 hover:border-line-strong focus:border-brand-line focus:bg-surface focus:ring-3 focus:ring-brand-line/15",
        )}
      />
    </form>
  );
}
