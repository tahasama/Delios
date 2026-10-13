import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrgAdmin } from "@/lib/org-scope";
import { openFirstProjectAction, addPersonAction } from "@/lib/actions/setup";
import { logoutAction } from "@/lib/actions/auth";
import { ActionForm } from "@/components/form";
import { Field, inputCls, btn } from "@/components/ui";
import { FolderPlus, UserPlus, Check, LogOut } from "lucide-react";
import { PROJECT_KINDS } from "@/lib/profiles/kinds";
import { contractRoleOptions } from "@/lib/contract-roles";
import { adminFunctions, adminUsers } from "@/lib/api/admin";
import { getSets } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up your organization" };

const KINDS = PROJECT_KINDS;

/**
 * The gap between registering an organization and having a project to work in.
 * Two things are possible here and nothing else: add the people who will work
 * with you, and open the first project.
 */
export default async function SetupPage() {
  const scope = await requireOrgAdmin();
  const { organization, user, projectCount } = scope;

  // Once a project exists this page has no job.
  if (projectCount > 0) redirect("/");

  const [functions, people, configSets] = await Promise.all([
    // The account-wide role a function stands for is read from what it may do.
    adminFunctions().then((all) => all.filter((f) => f.active).map((f) => {
      const verbs = new Set(f.rules.flatMap((r) => r.verbs));
      const legacyRole = verbs.has("CONFIGURE") ? "ADMIN" : verbs.has("CONTROL") ? "CONTROLLER" : verbs.has("APPROVE") ? "APPROVER"
        : verbs.has("REVIEW") ? "REVIEWER" : verbs.has("CREATE") || verbs.has("REVISE") ? "AUTHOR" : "VIEWER";
      return { ...f, legacyRole };
    })),
    adminUsers().then((all) => all.filter((u) => u.active).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.isAdmin ? "ADMIN" : "VIEWER" }))),
    getSets().then((all) => all.length),
  ]);
  const labelFor = (role: string) => functions.find((f) => f.legacyRole === role)?.name ?? role;
  const roleOptions = await contractRoleOptions();

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-4">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-sm font-black text-white">D</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-900">{organization.name}</p>
            <p className="text-[11px] text-slate-400">Setting up · {user.name}</p>
          </div>
          <form action={logoutAction}>
            <button type="submit" className={btn("ghost", "sm")}>
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Your organization is ready</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-500">
            {configSets} value sets, the numbering schemes and the permission matrix are already published for{" "}
            {organization.name}. They are shared by every project you run, so you only do this once.
          </p>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700">
            <Check className="h-4 w-4" /> Configuration published — nothing else needed before you start
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* People first: they join the project automatically when it opens. */}
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-tint text-brand-ink">
                <UserPlus className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Add your people</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Optional now, and easy later. Anyone you add joins your first project when you open it.
                </p>
              </div>
            </div>

            {people.length > 1 ? (
              <ul className="mt-4 space-y-1 border-t border-line pt-3">
                {people.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-slate-700">
                      {p.name}
                      {p.id === user.id ? <span className="ml-1 text-slate-400">(you)</span> : null}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-400">{labelFor(p.role)}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 border-t border-line pt-4">
              <ActionForm action={addPersonAction} submitLabel="Add person" size="sm" resetOnSuccess>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Full name" required><input name="name" required className={inputCls} /></Field>
                  <Field label="Email" required><input type="email" name="email" required className={inputCls} /></Field>
                </div>
                <Field label="Function" required hint="What they do — change it any time">
                  <select name="functionId" required className={inputCls} defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {functions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </Field>
                <Field label="Initial password" required hint="You hand this over yourself — nothing is emailed">
                  <input name="password" required minLength={8} className={inputCls} placeholder="min 8 characters" />
                </Field>
              </ActionForm>
            </div>
          </section>

          {/* The project: the step that turns setup into the working app. */}
          <section className="rounded-2xl border border-brand-line/40 bg-surface p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-white">
                <FolderPlus className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Open your first project</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Every controlled document lives in a project. This creates its register, its number sequences and its
                  scope statement.
                </p>
              </div>
            </div>

            <div className="mt-4 border-t border-line pt-4">
              <ActionForm action={openFirstProjectAction} submitLabel="Open project and start work">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_130px]">
                  <Field label="Project name" required>
                    <input name="name" required className={inputCls} placeholder="North plant upgrade" />
                  </Field>
                  <Field label="Code" required>
                    <input name="code" required defaultValue="P1" className={`${inputCls} uppercase`} />
                  </Field>
                </div>
                <Field label="Type" hint="Affects defaults only, never the rules">
                  <select name="kind" className={inputCls} defaultValue="GENERIC">
                    {KINDS.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
                  </select>
                </Field>
                <Field label="What you do on it" hint="Decides where approval sits, and the matrix it starts from">
                  <select name="role" className={inputCls} defaultValue="GENERIC">
                    {roleOptions.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                </Field>
                <p className="text-[11px] text-slate-400">
                  {people.length === 1
                    ? "You will be its administrator."
                    : `All ${people.length} people you have added join it.`}
                </p>
              </ActionForm>
            </div>
          </section>
        </div>

        <p className="text-center text-[11px] text-slate-400">
          Prefer to look around first? <Link href="/settings/config" className="font-semibold text-link hover:underline">Review the published configuration</Link>{" "}
          — though most of the app needs a project before it has anything to show.
        </p>
      </main>
    </div>
  );
}
