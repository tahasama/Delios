import Link from "next/link";
import { BookOpen, ChevronDown, LogOut, UserRound } from "lucide-react";
import { requireSession } from "@/lib/session";
import { signOutAction } from "@/lib/actions/session";
import { isMigrated } from "@/lib/migrated";
import { Sidebar, MobileNav, SearchBox } from "@/components/navigation";
import { ProjectPicker } from "@/components/project-picker";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The frame around every signed-in screen: the menu, the project picker, search
 * and the person's menu. What the menu offers comes from what the person's
 * function allows on this project, so nobody is offered a page that refuses them.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const { user, project, projects } = session;
  const perms = {
    canRead: session.can("READ"),
    canTransmit: session.can("TRANSMIT"),
    canControl: session.can("CONTROL"),
    canConfigure: user.isAdmin,
    canCreate: session.can("CREATE") && user.isInternal,
    external: !user.isInternal,
  };

  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar perms={perms} />
      <div className="lg:pl-(--sidebar-w)">
        <header data-app-header className="no-print sticky top-0 z-10 flex h-18 items-center gap-3 border-b border-line/80 bg-surface/94 px-4 backdrop-blur sm:gap-5 sm:px-6 lg:px-8">
          <MobileNav perms={perms} />
          <ProjectPicker current={project} available={projects} organizationName={user.organization} />
          <SearchBox className="hidden max-w-xl flex-1 md:block" />
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <details className="group relative ml-1">
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl border border-line bg-surface px-2 py-1.5 sm:px-3 sm:py-2 outline-none transition hover:border-line-strong focus-visible:ring-3 focus-visible:ring-link/15">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-tint text-xs font-bold text-brand-ink">{user.name.slice(0, 1).toUpperCase()}</span>
                <span className="hidden min-w-28 sm:block">
                  <span className="block text-xs font-semibold leading-tight text-slate-800">{user.name}</span>
                  <span className="mt-0.5 block text-[11px] leading-tight text-slate-400">{project.function.name}</span>
                </span>
                <ChevronDown className="hidden h-3.5 w-3.5 text-slate-400 transition group-open:rotate-180 sm:block" />
              </summary>
              <div className="absolute right-0 top-12 z-30 w-64 rounded-2xl border border-line bg-surface p-2 shadow-xl">
                <div className="flex items-center gap-3 border-b border-line px-3 py-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600"><UserRound className="h-4 w-4" /></span>
                  <div><p className="text-xs font-semibold text-slate-800">{user.name}</p><p className="text-[11px] text-slate-400">{user.organization}</p></div>
                </div>
                {isMigrated("/guide") ? (
                  <Link href="/guide" className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"><BookOpen className="h-4 w-4" /> Help & orientation</Link>
                ) : null}
                <form action={signOutAction}>
                  <button type="submit" className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-red-700"><LogOut className="h-4 w-4" /> Sign out</button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <main className="mx-auto max-w-[1560px] px-4 py-5 lg:px-7 lg:py-6">{children}</main>
      </div>
    </div>
  );
}
