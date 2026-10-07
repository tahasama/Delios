import { redirect } from "next/navigation";
import { FolderOpen, LogOut } from "lucide-react";
import { getMe } from "@/lib/session";
import { signOutAction } from "@/lib/actions/session";
import { btn } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "No project" };

/**
 * Signed in, but on no project yet. Access is held per project, so there is
 * nothing to show until an administrator adds them: say that plainly.
 */
export default async function NoProjectPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.projects.length > 0) redirect("/");
  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-6">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-tint text-brand-ink"><FolderOpen className="h-6 w-6" /></span>
        <h1 className="mt-4 text-xl font-semibold text-slate-900">You are not on a project yet</h1>
        <p className="mt-2 text-sm text-slate-600">
          You are signed in to {me.tenant.name} as {me.user.email}, but nobody has added you to a project.
          Ask an administrator of your organization to add you, with the function you hold.
        </p>
        <form action={signOutAction} className="mt-6">
          <button type="submit" className={btn("secondary")}><LogOut className="h-4 w-4" /> Sign out</button>
        </form>
      </div>
    </div>
  );
}
