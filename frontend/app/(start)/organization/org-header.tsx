import Link from "next/link";
import { logoutAction } from "@/lib/account/forms-sign-in";
import { btn } from "@/components/ui";
import { ArrowLeft, LogOut } from "lucide-react";
import type { OrgScope } from "@/lib/core/org-scope";

/** The band at the top of the organization's pages: who, and the way back. */
export function OrgHeader({ scope, back, support }: { scope: OrgScope; back?: { href: string; label: string }; support?: React.ReactNode }) {
  const way = back ?? (scope.projectCount ? { href: "/", label: "Back to projects" } : { href: "/setup", label: "Set up" });
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-sm font-black text-white">D</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-900" title={scope.organization.name}>{scope.organization.name}</p>
          <p className="text-[11px] text-slate-400">Organization · {scope.user.name}</p>
        </div>
        {support}
        {/* On a phone the two ways out keep only their icons, so the organization's name has the room. */}
        <Link href={way.href} title={way.label} aria-label={way.label} className={btn("ghost", "sm")}><ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">{way.label}</span></Link>
        <form action={logoutAction}><button type="submit" title="Sign out" aria-label="Sign out" className={btn("ghost", "sm")}><LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span></button></form>
      </div>
    </header>
  );
}
