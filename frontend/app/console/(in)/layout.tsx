import { LogOut } from "lucide-react";
import { btn } from "@/components/ui";
import { requireOperator } from "@/lib/console/client";
import { consoleSignOutAction } from "@/lib/console/forms";
import { ConsoleTabs } from "./console-tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Console", template: "%s · DELIOS console" } };

/**
 * The DELIOS team's own space (owner: "the US space"), above every organization: its band, its tabs, then the page.
 * Its own sign-in, never an organization's account (backend `Operators/`).
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const me = await requireOperator();
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-brand text-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-sm font-black">D</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">DELIOS console</p>
            <p className="text-[11px] text-white/60">The team that runs DELIOS · {me.name}</p>
          </div>
          <form action={consoleSignOutAction}>
            <button type="submit" title="Sign out" aria-label="Sign out" className={`${btn("ghost", "sm")} text-white/80 hover:bg-white/10 hover:text-white`}>
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
            </button>
          </form>
        </div>
      </header>
      {me.authenticatorOff ? (
        <p role="alert" className="border-b border-red-300 bg-red-50 px-4 py-2 text-center text-[13px] font-semibold text-red-800">
          The authenticator is switched off: the console opens with a password alone. For testing only: set CONSOLE_AUTHENTICATOR=true in .env (or remove the line) before real use.
        </p>
      ) : null}
      <ConsoleTabs />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6">{children}</main>
    </div>
  );
}
