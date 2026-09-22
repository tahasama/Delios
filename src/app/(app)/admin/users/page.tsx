import { isAdmin } from "@/lib/auth";
import { requireScope } from "@/lib/scope";
import { PageHeader, DataTable, Th, Td, Chip, Card, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { createUserAction, savePersonAction } from "@/lib/actions/admin";
import { inviteGuestAction, createVisitorAction } from "@/lib/actions/guests";

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
  const deptLabel = (code: string) => disciplines.find((d) => d.code === code)?.label ?? code;

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
                    {parties.filter((party) => party.active).map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}
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
                      {externalParties.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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

      <Card title={`Our people · ${users.length}`} description={`Job and department shown for ${project.code}. What a job may do is set in Functions and the distribution matrix.`}>
        <DataTable head={<tr><Th>Person</Th><Th>Company</Th><Th>Job on {project.code}</Th><Th>Department</Th><Th>Other projects</Th><Th></Th></tr>}>
          {users.map((u) => {
            const here = u.memberships.find((m) => m.projectId === projectId);
            const elsewhere = u.memberships.filter((m) => m.projectId !== projectId);
            return (
              <tr key={u.id} className={u.active ? "align-top" : "align-top opacity-50"}>
                <Td>
                  <span className="font-medium text-slate-800">{u.name}</span>{u.id === me.id ? <span className="ml-1 text-xs text-slate-400">(you)</span> : null}
                  <span className="block text-[11px] text-slate-400">{u.email}{u.active ? "" : " · switched off"}</span>
                </Td>
                <Td className="text-xs">{u.party?.name ?? u.organization ?? "—"}</Td>
                <Td className="text-xs">{here ? here.function.name : <span className="text-amber-700">not on {project.code}</span>}</Td>
                <Td className="text-xs">{here?.department ? deptLabel(here.department) : "—"}</Td>
                <Td className="text-xs">{elsewhere.length ? elsewhere.map((m) => `${m.project.code} · ${m.function.name}`).join(", ") : "—"}</Td>
                <Td>
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold text-link">Edit</summary>
                    <div className="mt-2 w-[min(90vw,34rem)]">
                      <ActionForm action={savePersonAction} submitLabel="Save" size="sm" hidden={{ userId: u.id }}>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <Field label="Name" required><input name="name" required defaultValue={u.name} className={inputCls} /></Field>
                          <Field label="Email" required><input type="email" name="email" required defaultValue={u.email} className={inputCls} /></Field>
                          <Field label="Works for">
                            <select name="partyId" defaultValue={u.partyId ?? ""} className={inputCls}>
                              <option value="">—</option>
                              {parties.filter((p) => p.active || p.id === u.partyId).map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : " (revoked)"}</option>)}
                            </select>
                          </Field>
                          <Field label={`Job on ${project.code}`} required={!here}>
                            <select name="functionId" defaultValue={here?.functionId ?? ""} className={inputCls}>
                              <option value="">{here ? "unchanged" : "Choose… (adds them to the project)"}</option>
                              {functionOptions}
                            </select>
                          </Field>
                          <Field label="Department" hint="receives its requirements calls, confirms readiness">
                            <select name="department" defaultValue={here?.department ?? ""} className={inputCls}>
                              <option value="">None</option>
                              {disciplines.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                            </select>
                          </Field>
                          <label className="flex items-center gap-2 self-end pb-2 text-xs text-slate-600"><input type="checkbox" name="active" defaultChecked={u.active} /> Can sign in</label>
                        </div>
                      </ActionForm>
                    </div>
                  </details>
                </Td>
              </tr>
            );
          })}
        </DataTable>
      </Card>

      {guests.length ? (
        <Card title={`From other organizations · ${guests.length}`} description="Their accounts belong to their company; you decide their job and department here, and can end their access.">
          <DataTable head={<tr><Th>Person</Th><Th>Company</Th><Th>Project · job</Th><Th>Department</Th><Th></Th></tr>}>
            {guests.map((g) => (
              <tr key={g.id} className="align-top">
                <Td>{g.user.name}<span className="block text-[11px] text-slate-400">{g.user.email}</span></Td>
                <Td className="text-xs">{g.user.org.name}</Td>
                <Td className="text-xs">{g.project.code} · {g.function.name}</Td>
                <Td className="text-xs">{g.department ? deptLabel(g.department) : "—"}</Td>
                <Td>
                  {g.projectId === projectId ? (
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-link">Edit</summary>
                      <div className="mt-2 w-[min(90vw,30rem)]">
                        <ActionForm action={savePersonAction} submitLabel="Save" size="sm" hidden={{ userId: g.user.id }}>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <Field label={`Job on ${project.code}`}>
                              <select name="functionId" defaultValue={g.functionId} className={inputCls}>{functionOptions}</select>
                            </Field>
                            <Field label="Department">
                              <select name="department" defaultValue={g.department ?? ""} className={inputCls}>
                                <option value="">None</option>
                                {disciplines.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                              </select>
                            </Field>
                            <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="active" defaultChecked /> Keeps access to {project.code}</label>
                          </div>
                        </ActionForm>
                      </div>
                    </details>
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
        <span className="text-sm font-semibold text-brand-ink">+ {title}</span>
        <span className="ml-2 text-xs text-slate-500">{hint}</span>
      </summary>
      <div className="mt-3 max-w-3xl">{children}</div>
    </details>
  );
}
