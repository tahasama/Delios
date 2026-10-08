import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { btn } from "@/components/ui";
import { FolderOpen, LogOut } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "No project" };

/**
 * A signed-in user with no active membership. Access is held per project, so
 * there is nothing to show until someone enrols them — say that plainly and
 * name who can do it, rather than bouncing them to an empty register.
 */
export default async function NoProjectPage() {
  const user = await requireUser();

  // Naming the administrators is the whole point of this page, but the backend
  // names them only to administrators and Document Control, so none are listed.
  const admins: { name: string; email: string; role: string }[] = [];

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-6">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-tint text-brand-ink">
          <FolderOpen className="h-6 w-6" />
        </span>
        <h1 className="mt-5 text-xl font-semibold text-slate-800">You are not on a project yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Signed in as <span className="font-medium text-slate-700">{user.name}</span> ({user.email}). Access to
          controlled information is granted per project, so there is nothing to show until you are added to one.
        </p>

        {admins.length ? (
          <div className="mt-6 rounded-xl border border-line bg-slate-50/60 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Who can add you</p>
            <ul className="mt-2 space-y-1.5">
              {admins.map((a) => (
                <li key={a.email} className="text-sm text-slate-700">
                  {a.name} <span className="text-slate-400">— {a.email}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <form action={logoutAction} className="mt-6">
          <button type="submit" className={btn("secondary", "sm")}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
