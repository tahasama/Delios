import { DateFormatKeeper } from "@/components/date-format";
import { Downloads } from "@/components/downloads";
import { dateFormat } from "@/lib/core/date-format";
import { mayCreateDocument, isAdmin } from "@/lib/core/auth";
import { requireScope } from "@/lib/core/scope";
import { unreadNotifications } from "@/lib/account/api";
import { Sidebar, MobileNav, SearchBox } from "@/app/(app)/navigation";
import { ProjectSwitcher } from "@/app/(app)/project-switcher";
import { elsewhere } from "@/lib/organization/api";
import { logoutAction } from "@/lib/account/forms-sign-in";
import { Bell, BookOpen, Building2, ChevronDown, LogOut, Settings, UserRound, KeyRound } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/app/(app)/theme-toggle";
import { ToolLink } from "@/app/(app)/top-tools";
import { ROLE_LABEL } from "@/lib/core/standard";
import type { Role } from "@/lib/core/standard";
import { SETUP_PAGES, maySetup } from "@/app/(app)/settings/setup-pages";
import { controlDoes } from "@/lib/settings/control-activities";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireScope();
  const { user, project, available, role } = ctx;
  // The organization's name is the account's.
  const [unread, others, managementAddsPeople] = await Promise.all([
    unreadNotifications(), elsewhere(), controlDoes(ctx, "PROJECT_PEOPLE").then((dc) => !dc).catch(() => false),
  ]);
  const scope = { organizationName: user.organization };

  // The navigation is built from what this person may actually do, so nobody
  // is offered a destination that will refuse them.
  const perms = {
    canRead: ctx.can("READ"),
    canTransmit: ctx.can("TRANSMIT"),
    canControl: ctx.can("CONTROL"),
    // Import & export opens for administrators and anyone granted a settings verb.
    canConfigure: ctx.can("CONFIGURE") || ctx.can("MATRIX") || ctx.can("ROUTES"),
    // The Settings link shows exactly when a Settings page opens for this person: never a dead end, never a page
    // they may open but cannot reach.
    canSettings: SETUP_PAGES.some((page) => maySetup(user, page, managementAddsPeople)),
    canCreate: ctx.can("CREATE") && mayCreateDocument(user),
    // Another organization on this project: only what concerns them.
    external: !user.isInternal,
  };

  return (
    <div className="min-h-screen bg-canvas">
      <DateFormatKeeper value={dateFormat()} />
      <Sidebar perms={perms} />
      {/* The content starts where the sidebar ends, whatever width it has been
          dragged or collapsed to. One class: --sidebar-w defaults to 268px in
          globals.css, so there is no second, fixed width to compete with it. */}
      <div className="lg:pl-(--sidebar-w) print:pl-0">
        {/* As tall as the menu's mark and closed by the same line: the two bars read as one frame. */}
        <header data-app-header className="no-print sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur-md sm:gap-4 sm:px-6 lg:px-7">
          <MobileNav perms={perms} />
          <ProjectSwitcher
            current={project}
            available={available}
            role={role}
            functionName={user.functionName ?? null}
            organizationName={scope?.organizationName ?? user.organization ?? "Organization"}
            elsewhere={others}
          />
          <SearchBox className="hidden max-w-lg flex-1 md:block" />
          <div className="ml-auto flex items-center gap-1">
            <ToolLink href="/guide" label="Help & orientation" wide="Help"><BookOpen className="h-4.5 w-4.5" /></ToolLink>
            {/* Settings, for whoever a Settings page opens to (owner: in the top bar), lit while you are in them. */}
            {perms.canSettings ? <ToolLink href="/settings" label="Settings"><Settings className="h-4.5 w-4.5" /></ToolLink> : null}
            <ThemeToggle />
            <ToolLink href="/notifications" label={unread ? `Notifications: ${unread} unread` : "Notifications"}>
              <Bell className="h-4.5 w-4.5" />
              {unread > 0 ? (
                <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-surface tabular-nums">
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
            </ToolLink>
            <span aria-hidden className="mx-2 hidden h-6 w-px bg-line sm:block" />
            <details className="group relative">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-link/30 group-open:bg-slate-100">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-strong text-xs font-bold text-white">{user.name.slice(0, 1).toUpperCase()}</span>
                <span className="hidden min-w-0 max-w-40 sm:block">
                  <span className="block truncate text-[13px] font-semibold leading-tight text-slate-800">{user.name}</span>
                  <span className="mt-0.5 block truncate text-[11px] leading-tight text-slate-500">{user.functionName ?? ROLE_LABEL[user.role as Role] ?? user.role}</span>
                </span>
                <ChevronDown className="hidden h-3.5 w-3.5 text-slate-400 transition group-open:rotate-180 sm:block" />
              </summary>
              <div className="absolute right-0 top-12 z-30 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-[0_12px_32px_-8px_rgb(16_42_67/0.25)]">
                <div className="flex items-center gap-3 border-b border-line px-2.5 pb-2.5 pt-1.5"><span className="grid h-9 w-9 place-items-center rounded-full bg-tint text-brand-ink"><UserRound className="h-4 w-4"/></span><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800">{user.name}</p><p className="truncate text-[11px] text-slate-500">{user.organization}</p></div></div>
                <Link href="/account" className="mt-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><KeyRound className="h-4 w-4 text-slate-500"/> Your sign-in</Link>
                {isAdmin(user) ? <Link href="/organization" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Building2 className="h-4 w-4 text-slate-500"/> {user.organization}</Link> : null}
                <Link href="/guide" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><BookOpen className="h-4 w-4 text-slate-500"/> Help & orientation</Link>
                <form action={logoutAction} className="mt-1 border-t border-line pt-1"><button type="submit" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-red-50 hover:text-red-700"><LogOut className="h-4 w-4"/> Sign out</button></form>
              </div>
            </details>
          </div>
        </header>
        <main className="mx-auto max-w-[1560px] px-4 py-5 lg:px-7 lg:py-6">{children}</main>
        <Downloads />
      </div>
    </div>
  );
}
