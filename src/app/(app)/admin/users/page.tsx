import { isAdmin } from "@/lib/auth";
import { requireScope } from "@/lib/scope";
import { PageHeader, DataTable, Th, Td, Chip, Card, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { createUserAction, updateUserAction } from "@/lib/actions/admin";
import { setUserPartyAction } from "@/lib/actions/workflow";
import { inviteGuestAction, createVisitorAction, removeFromProjectAction } from "@/lib/actions/guests";

export const dynamic = "force-dynamic";
export const metadata = { title: "People & access" };

export default async function AdminUsersPage() {
  const { user: me, db, projectId, project } = await requireScope();
  if (!isAdmin(me)) {
    return <PageHeader title="People & access" subtitle="Administrators only." />;
  }
  // Scoped to this administrator's organization: they can see and add people
  // here and nowhere else.
  const [users, parties, projects, functions, disciplines, guests] = await Promise.all([
    db.user.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        party: true,
        memberships: {
          where: { active: true },
          include: { project: { select: { code: true, name: true } }, function: { select: { name: true, clearance: true } } },
        },
      },
    }),
    db.party.findMany({ orderBy: [{ isInternal: "desc" }, { name: "asc" }] }),
    db.project.findMany({ where: { orgId: me.orgId, status: "ACTIVE" }, orderBy: { code: "asc" } }),
    db.function.findMany({ where: { active: true }, orderBy: { sort: "asc" } }),
    db.configValue.findMany({ where: { setKey: "DISCIPLINES", status: "ACTIVE" }, orderBy: { label: "asc" }, select: { code: true, label: true } }),
    // People on this organization's projects whose accounts live elsewhere.
    db.projectMembership.findMany({
      where: { active: true, project: { orgId: me.orgId }, user: { orgId: { not: me.orgId } } },
      include: {
        user: { select: { id: true, name: true, email: true, org: { select: { name: true } } } },
        project: { select: { code: true, name: true } },
        function: { select: { name: true, clearance: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const externalParties = parties.filter((p) => !p.isInternal);

  const functionOptions = functions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>);
  const projectPicker = (
    <Field label="Projects" required hint="Ctrl/Cmd-click for several">
      <select name="projectIds" multiple required size={Math.min(5, Math.max(2, projects.length))} className={`${inputCls} h-auto py-1.5`}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
      </select>
    </Field>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="People & access" subtitle={`Access is per project. Functions shown are for ${project.code} unless marked.`} />

      <Card title="Add someone">
        <div className="divide-y divide-slate-100">
          <AddWay title="Someone in our organization" hint="They sign in straight away with the password you set.">
            <ActionForm action={createUserAction} submitLabel="Create account" size="sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Full name" required><input name="name" required className={inputCls} /></Field>
                <Field label="Email" required><input type="email" name="email" required className={inputCls} /></Field>
                <Field label="Works for" required>
                  <select name="partyId" required className={inputCls} defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {parties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}
                  </select>
                </Field>
                <Field label="Function" required><select name="functionId" required className={inputCls} defaultValue=""><option value="" disabled>Choose…</option>{functionOptions}</select></Field>
                <Field label="Password" required><input name="password" required minLength={8} className={inputCls} placeholder="at least 8 characters" /></Field>
                {projectPicker}
              </div>
            </ActionForm>
          </AddWay>

          <AddWay title="Someone whose company already uses this system" hint="Invite them. Their account stays with their company; you decide what they do here.">
            <ActionForm action={inviteGuestAction} submitLabel="Invite" size="sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Their email" required><input type="email" name="email" required className={inputCls} placeholder="the address they sign in with" /></Field>
                <Field label="Function here" required><select name="functionId" required className={inputCls} defaultValue=""><option value="" disabled>Choose…</option>{functionOptions}</select></Field>
                {projectPicker}
              </div>
            </ActionForm>
          </AddWay>

          <AddWay title="An outsider with no account" hint="Create a visitor. You own the account and can switch it off when they leave.">
            {externalParties.length === 0 ? (
              <p className="text-xs text-amber-800">Add their company in Parties first.</p>
            ) : (
              <ActionForm action={createVisitorAction} submitLabel="Create visitor" size="sm">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Full name" required><input name="name" required className={inputCls} /></Field>
                  <Field label="Email" required><input type="email" name="email" required className={inputCls} /></Field>
                  <Field label="Works for" required>
                    <select name="partyId" required className={inputCls} defaultValue="">
                      <option value="" disabled>Choose…</option>
                      {externalParties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Function" required><select name="functionId" required className={inputCls} defaultValue=""><option value="" disabled>Choose…</option>{functionOptions}</select></Field>
                  <Field label="Password" required><input name="password" required minLength={8} className={inputCls} placeholder="at least 8 characters" /></Field>
                  {projectPicker}
                </div>
              </ActionForm>
            )}
          </AddWay>
        </div>
      </Card>

      <Card title={`Our people · ${users.length}`}>
        <DataTable head={<tr><Th>Name</Th><Th>Works for</Th><Th>Projects</Th><Th></Th></tr>}>
          {users.map((u) => (
            <tr key={u.id} className={u.active ? "" : "opacity-50"}>
              <Td>
                <span className="font-medium text-slate-800">{u.name}</span>{u.id === me.id ? <span className="ml-1 text-xs text-slate-400">(you)</span> : null}
                <span className="block text-[11px] text-slate-400">{u.email}</span>
              </Td>
              <Td className="text-xs">{u.party?.name ?? u.organization ?? "—"}</Td>
              <Td className="text-xs">
                {u.memberships.length ? (
                  <span className="flex flex-wrap gap-1">
                    {u.memberships.map((m) => <Chip key={m.id} title={m.project.name}>{m.project.code} · {m.function.name}{m.department ? ` · ${m.department}` : ""}</Chip>)}
                  </span>
                ) : <span className="text-amber-700">no project</span>}
                {!u.active ? <span className="ml-1 text-slate-500">· switched off</span> : null}
              </Td>
              <Td>
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-[#315f83]">Change</summary>
                  <div className="mt-2">
                    <ActionForm action={updateUserAction} submitLabel="Save" size="sm" hidden={{ userId: u.id }} className="flex flex-wrap items-center gap-2 space-y-0">
                      <select name="functionId" defaultValue={u.memberships.find((m) => m.projectId === projectId)?.functionId ?? ""} className="rounded-md border border-slate-300 px-1.5 py-1 text-xs" title={`Function on ${project.code}`}>
                        <option value="">Function on {project.code}: unchanged</option>
                        {functionOptions}
                      </select>
                      {u.memberships.some((m) => m.projectId === projectId) ? (
                        <select name="department" defaultValue={u.memberships.find((m) => m.projectId === projectId)?.department ?? ""} className="rounded-md border border-slate-300 px-1.5 py-1 text-xs" title="Department this person answers for">
                          <option value="">Department: none</option>
                          {disciplines.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                        </select>
                      ) : null}
                      <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" name="active" defaultChecked={u.active} /> can sign in</label>
                    </ActionForm>
                    <ActionForm action={setUserPartyAction} submitLabel="Save" size="sm" hidden={{ userId: u.id }} className="mt-2 flex flex-wrap items-center gap-2 space-y-0">
                      <select name="partyId" defaultValue={u.partyId ?? ""} className="rounded-md border border-slate-300 px-1.5 py-1 text-xs" title="Works for">
                        <option value="">Works for: —</option>
                        {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </ActionForm>
                  </div>
                </details>
              </Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      {guests.length ? (
        <Card title={`From other organizations · ${guests.length}`} description="Their accounts belong to their company; you only control what they do here.">
          <DataTable head={<tr><Th>Name</Th><Th>Company</Th><Th>Project</Th><Th></Th></tr>}>
            {guests.map((g) => (
              <tr key={g.id}>
                <Td>{g.user.name}<span className="block text-[11px] text-slate-400">{g.user.email}</span></Td>
                <Td className="text-xs">{g.user.org.name}</Td>
                <Td className="text-xs">{g.project.code} · {g.function.name}</Td>
                <Td>
                  {g.projectId === projectId ? (
                    <ActionForm action={removeFromProjectAction} submitLabel="Remove" variant="secondary" size="sm" hidden={{ userId: g.user.id }} confirmText={`Remove ${g.user.name} from ${g.project.code}? Their own account is untouched.`} className="space-y-0" />
                  ) : <span className="text-[11px] text-slate-400">switch to {g.project.code} to change</span>}
                </Td>
              </tr>
            ))}
          </DataTable>
        </Card>
      ) : null}
    </div>
  );
}

function AddWay({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <details className="py-2.5">
      <summary className="cursor-pointer list-none">
        <span className="text-sm font-semibold text-[#1e3a5f]">+ {title}</span>
        <span className="ml-2 text-xs text-slate-500">{hint}</span>
      </summary>
      <div className="mt-3 max-w-3xl">{children}</div>
    </details>
  );
}
