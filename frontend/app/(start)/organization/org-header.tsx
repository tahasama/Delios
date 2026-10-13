import Link from "next/link";
import { logoutAction } from "@/lib/account/forms-sign-in";
import { btn } from "@/components/ui";
import { ArrowLeft, LogOut } from "lucide-react";
import type { OrgScope } from "@/lib/core/org-scope";

/** The band at the top of the organization's pages: who, and the way back. */
export function OrgHeader({ scope, back }: { scope: OrgScope; back?: { href: string; label: string } }) {
  const way = back ?? (scope.projectCount ? { href: "/", label: "Back to projects" } : { href: "/setup", label: "Set up" });
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-sm font-black text-white">D</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-900">{scope.organization.name}</p>
          <p className="text-[11px] text-slate-400">Organization · {scope.user.name}</p>
        </div>
        <Link href={way.href} className={btn("ghost", "sm")}><ArrowLeft className="h-4 w-4" /> {way.label}</Link>
        <form action={logoutAction}><button type="submit" className={btn("ghost", "sm")}><LogOut className="h-4 w-4" /> Sign out</button></form>
      </div>
    </header>
  );
}
