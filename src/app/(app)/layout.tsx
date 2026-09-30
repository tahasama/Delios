import { mayCreateDocument } from "@/lib/auth";
import { requireScope } from "@/lib/scope";
import { Sidebar, MobileNav, SearchBox } from "@/components/navigation";
import { ProjectSwitcher } from "@/components/project-switcher";
import { logoutAction } from "@/lib/actions/auth";
import { Bell, BookOpen, ChevronDown, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { ROLE_LABEL } from "@/lib/standard";
import type { Role } from "@/lib/standard";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireScope();
  const { user, db, project, available, role } = ctx;
  const [unread, scope] = await Promise.all([
    db.notification.count({ where: { userId: user.id, read: false } }),
    db.scopeConfig.findFirst(),
  ]);

  // The navigation is built from what this person may actually do, so nobody
  // is offered a destination that will refuse them.
  const perms = {
    canRead: ctx.can("READ"),
    canTransmit: ctx.can("TRANSMIT"),
    canControl: ctx.can("CONTROL"),
    // Settings opens for administrators and for anyone granted a settings verb.
    canConfigure: ctx.can("CONFIGURE") || ctx.can("MATRIX") || ctx.can("ROUTES"),
    canCreate: ctx.can("CREATE") && mayCreateDocument(user),
  };

  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar perms={perms} />
      {/* The content starts where the sidebar ends, whatever width it has been
          dragged or collapsed to. One class: --sidebar-w defaults to 268px in
          globals.css, so there is no second, fixed width to compete with it. */}
      <div className="lg:pl-(--sidebar-w)">
        <header data-app-header className="no-print sticky top-0 z-10 flex h-18 items-center gap-3 border-b border-line/80 bg-surface/94 px-4 backdrop-blur sm:gap-5 sm:px-6 lg:px-8">
          <MobileNav perms={perms} />
          <ProjectSwitcher
            current={project}
            available={available}
            role={role}
            functionName={user.functionName ?? null}
            organizationName={scope?.organizationName ?? user.organization ?? "Organization"}
          />
          <SearchBox className="hidden max-w-xl flex-1 md:block" />
          <div className="ml-auto flex items-center gap-2">
            <Link href="/guide" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
              <BookOpen className="h-4 w-4" /> <span className="hidden sm:inline">Explore</span>
            </Link>
            <ThemeToggle />
            <Link href="/notifications" className="relative rounded-xl p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800" title="Notifications">
              <Bell className="h-5 w-5" />
              {unread > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
            </Link>
            <details className="group relative ml-1">
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-line bg-surface px-2 py-1.5 sm:px-3 sm:py-2 outline-none transition hover:border-line-strong focus-visible:ring-3 focus-visible:ring-link/15">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-tint text-xs font-bold text-brand-ink">{user.name.slice(0, 1).toUpperCase()}</span>
                <span className="hidden min-w-28 sm:block"><span className="block text-xs font-semibold leading-tight text-slate-800">{user.name}</span><span className="mt-0.5 block text-[11px] leading-tight text-slate-400">{user.functionName ?? ROLE_LABEL[user.role as Role] ?? user.role}</span></span>
                <ChevronDown className="hidden h-3.5 w-3.5 text-slate-400 transition group-open:rotate-180 sm:block" />
              </summary>
              <div className="absolute right-0 top-12 z-30 w-64 rounded-2xl border border-line bg-surface p-2 shadow-xl">
                <div className="flex items-center gap-3 border-b border-line px-3 py-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600"><UserRound className="h-4 w-4"/></span><div><p className="text-xs font-semibold text-slate-800">{user.name}</p><p className="text-[11px] text-slate-400">{user.organization}</p></div></div>
                <Link href="/guide" className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><BookOpen className="h-4 w-4"/> Help & orientation</Link>
                <form action={logoutAction}><button type="submit" className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-red-700"><LogOut className="h-4 w-4"/> Sign out</button></form>
              </div>
            </details>
          </div>
        </header>
        <main className="mx-auto max-w-[1560px] px-4 py-5 lg:px-7 lg:py-6">{children}</main>
      </div>
    </div>
  );
}
