import { controlDoes } from "@/lib/settings/control-activities";
import Link from "next/link";
import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/core/scope";
import { PageHeader, DataTable, Th, Td, Card, Field, inputCls, btn } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { Asked, Added } from "@/components/policy-fields";
import { formPolicy } from "@/lib/settings/field-policy";
import { createUserAction, savePersonAction, takeOffProjectAction } from "@/lib/settings/forms-admin";
import { SearchPick } from "@/components/search-pick";
import { holdersOf } from "@/lib/core/permissions";
import { projectSettings } from "@/lib/settings/api";
import { CONFIRM_KEY, effectiveAnswer } from "@/lib/settings/control-activities";
import { projectOrganizations } from "@/lib/organization/api";
import { isAdmin } from "@/lib/core/auth";
import { createVisitorAction } from "@/lib/settings/forms-guests";
import { adminFunctions, adminParties, adminProjects, adminUsers } from "@/lib/settings/api-admin";
import { getMe } from "@/lib/account/api";
import { getActiveSet } from "@/lib/settings/config";
import { NoAccess } from "../no-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "People & access" };

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ org?: string; project?: string }> }) {
  const ctx = await requireScope();
  const { user: me, projectId, project } = ctx;
  const policy = await formPolicy(ctx, "PERSON");
  const sp = await searchParams;
  const withControl = await controlDoes(ctx, "PROJECT_PEOPLE");
  if (!maySetup(me, SETUP_PAGES.find((p) => p.href === "/settings/users")!, !withControl)) {
    return <NoAccess title="People & access" who="control" />;
  }
  // Scoped to this administrator's organization: they can see and add people
  // here and nowhere else.
  const [people, parties, projects, functions, disciplines, answers, managers, taking] = await Promise.all([
    adminUsers(),
    adminParties(),
    // Document Control adds people to the projects it is on; an administrator to any.
    adminProjects().catch(async () => (await getMe())?.projects ?? []).then((all) => all.filter((one) => one.status === "ACTIVE")),
    adminFunctions().then((all) => all.filter((one) => one.active)),
    getActiveSet("DISCIPLINES").then((all) => all.map((one) => ({ code: one.code, label: one.label })).sort((x, y) => x.label.localeCompare(y.label))),
    projectSettings(projectId).catch(() => new Map<string, string>()),
    holdersOf(ctx, "MANAGE").catch(() => []),
    projectOrganizations(ctx).catch(() => []),
  ]);
  // Joining waits for management where the project asks it (Settings, Control room); an administrator is never held.
  const confirming = !isAdmin(me) && effectiveAnswer(CONFIRM_KEY("PROJECT_PEOPLE"), answers.get(CONFIRM_KEY("PROJECT_PEOPLE"))) === "ON";
  const users = [...people]
    .sort((x, y) => Number(y.active) - Number(x.active) || x.name.localeCompare(y.name))
    .map((one) => ({
      ...one,
      organization: null as string | null,
      party: one.partyId ? { id: one.partyId, name: one.partyName ?? "", code: one.partyCode ?? "" } : null,
      // Not on the project yet: waiting for management, or refused.
      held: one.memberships.find((seat) => !seat.active && seat.projectId === projectId && (seat.pendingSince || seat.refusedAt)) ?? null,
      memberships: one.memberships.filter((seat) => seat.active).map((seat) => ({
        ...seat, project: { code: seat.projectCode, name: seat.projectName }, function: { name: seat.functionName },
      })),
    }));
  // Guests are people of an organization whose accounts we make: never a collaborator's (its administrator puts them
  // on) nor one not on DELIOS (nobody of theirs signs in).
  const externalParties = parties.filter((p) => !p.isInternal);
  const guestParties = externalParties.filter((p) => p.active && p.kind !== "COLLABORATOR" && p.kind !== "NOT_ON_DELIOS" && p.participation !== "BY_PROXY");
  const takesPart = new Set(taking.filter((one) => one.active).map((one) => one.partyId));
  const ourParties = parties.filter((p) => p.isInternal && p.active);
  const deptLabel = (code: string) => disciplines.find((d) => d.code === code)?.label ?? code;

  // Which people the list shows: everyone, or one organization's, and only
  // those on a chosen project.
  const shownOrg = sp.org ? parties.find((party) => party.id === sp.org) ?? null : null;
  const projectFilter = sp.project && projects.some((item) => item.id === sp.project) ? sp.project : "";
  const shown = users.filter((person) =>
    (!shownOrg || person.partyId === shownOrg.id)
    && (!projectFilter || person.memberships.some((seat) => seat.projectId === projectFilter)));

  const functionOptions = functions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>);
  // Which projects: ticks, at the control's own size, this project ticked to start with.
  const projectPicker = (
    <fieldset className="sm:col-span-2">
      <legend className="stencil mb-1.5 text-slate-500">Projects <span className="normal-case tracking-normal text-slate-500">· at least one</span></legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {projects.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" name="projectIds" value={p.id} defaultChecked={p.id === projectId} /> <span className="font-mono font-semibold">{p.code}</span> {p.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
  const departmentField = (
    <Field label="Department" hint="their discipline: told about actions, confirms going ahead">
      <select name="department" defaultValue="" className={inputCls}>
        <option value="">None</option>
        {disciplines.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
      </select>
    </Field>
  );
  // Who confirms them, when the project asks it: management first (recommended), anyone on the project still chosen.
  const onProject = people.filter((u) => u.active && u.memberships.some((m) => m.projectId === projectId && m.active));
  const confirmerField = confirming ? (
    <div className="sm:col-span-2">
      <SearchPick single name="confirmerId" label="Who confirms them" hint={`${project.code} asks management to confirm people; nobody chosen: every manager is asked`}
        initial={managers.length === 1 ? [managers[0].id] : []}
        items={[
          ...managers.map((m) => ({ id: m.id, name: m.name, detail: `${m.functionName} · recommended` })),
          ...onProject.filter((u) => !managers.some((m) => m.id === u.id)).map((u) => ({ id: u.id, name: u.name, detail: u.memberships.find((m) => m.projectId === projectId)?.functionName ?? null })),
        ]} />
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="People & access"
        subtitle={`Who is on ${project.code}, in which function and department. People are your organization's; their place on each project is that project's.${confirming ? ` On ${project.code}, management confirms each person added.` : ""}`}
        actions={<Link href="/import?kind=people" className={btn("secondary", "sm")}>Add a whole team from a spreadsheet</Link>}
      />

      <Card title="Add someone">
        <div className="divide-y divide-line">
          <AddWay title="Someone of our organization" hint="They get an email with a link to choose their own password.">
            <ActionForm action={createUserAction} submitLabel="Create account" size="sm">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Asked policy={policy} field="name">
                  {({ required }) => <input name="name" required={required} className={inputCls} />}
                </Asked>
                <Asked policy={policy} field="email">
                  {({ required }) => <input type="email" name="email" required={required} className={inputCls} />}
                </Asked>
                {ourParties.length > 1 ? (
                  <Asked policy={policy} field="partyId">
                    {({ required }) => (
                      <select name="partyId" required={required} className={inputCls} defaultValue="">
                        <option value="" disabled={required}>Choose…</option>
                        {ourParties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}
                      </select>
                    )}
                  </Asked>
                ) : <input type="hidden" name="partyId" value={ourParties[0]?.id ?? ""} />}
                <Asked policy={policy} field="functionId">
                  {({ required }) => (
                    <select name="functionId" required={required} className={inputCls} defaultValue="">
                      <option value="" disabled={required}>Choose…</option>
                      {functionOptions}
                    </select>
                  )}
                </Asked>
                {departmentField}
                {projectPicker}
                {confirmerField}
                <Added fields={policy.own} />
              </div>
            </ActionForm>
          </AddWay>

          {/* Someone whose company has its own DELIOS is never added here: once our organizations are linked, their
              administrator puts them on the project, and they sign in at home (docs/ORGANIZATIONS.md). */}
          <div className="py-2.5 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">Someone whose company has its own DELIOS?</span>{" "}
            Link the two organizations on <Link href="/settings/parties" className="font-semibold text-link hover:underline">Organizations</Link>;
            their administrator then puts them on the project, and they sign in with their own account.
          </div>

          <AddWay title="A guest: someone of another organization, with an account we make" hint="They get an email with a link to choose their own password. You can switch the account off when they leave.">
            {guestParties.length === 0 ? (
              <p className="text-xs text-slate-700">No guest organization is set up yet. Add it on <Link href="/settings/parties" className="font-semibold text-link hover:underline">Organizations</Link> (as a guest) first, then come back here.</p>
            ) : (
              <ActionForm action={createVisitorAction} submitLabel="Create visitor" size="sm">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Full name" required><input name="name" required className={inputCls} /></Field>
                  <Field label="Email" required><input type="email" name="email" required className={inputCls} /></Field>
                  <Field label="Organization" required hint="guest organizations only">
                    <select name="partyId" required className={inputCls} defaultValue="">
                      <option value="" disabled>Choose…</option>
                      {guestParties.map((p) => <option key={p.id} value={p.id}>{p.name}{takesPart.has(p.id) ? "" : ` (not taking part in ${project.code} yet)`}</option>)}
                    </select>
                  </Field>
                  <Field label="Function" required><select name="functionId" required className={inputCls} defaultValue=""><option value="" disabled>Choose…</option>{functionOptions}</select></Field>
                  {departmentField}
                  {projectPicker}
                  {confirmerField}
                </div>
              </ActionForm>
            )}
          </AddWay>
        </div>
      </Card>

      <Card
        title={shownOrg ? `${shownOrg.name} · ${shown.length}` : `Everyone · ${shown.length}`}
        description={shownOrg ? "Everyone recorded at this organization." : `Function and department shown for ${project.code}. What a function may do is set in Functions & permissions.`}
      >
        {/* Narrowing this list is two questions: whose people, and on which project. Both are links, so the answer
            can be shared. */}
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">Organization</span>
          <Link href="/settings/users" className={`rounded-md px-2 py-1 font-semibold ${shownOrg ? "text-link hover:bg-tint-soft" : "bg-tint text-slate-800"}`}>All</Link>
          {parties.map((party) => (
            <Link key={party.id} href={`/settings/users?org=${party.id}${projectFilter ? `&project=${projectFilter}` : ""}`}
              className={`rounded-md px-2 py-1 font-semibold ${shownOrg?.id === party.id ? "bg-tint text-slate-800" : "text-link hover:bg-tint-soft"}`}>
              {party.name}
            </Link>
          ))}
          {projects.length > 1 ? (
            <>
              <span className="ml-3 text-slate-500">Project</span>
              <Link href={shownOrg ? `/settings/users?org=${shownOrg.id}` : "/settings/users"} className={`rounded-md px-2 py-1 font-semibold ${projectFilter ? "text-link hover:bg-tint-soft" : "bg-tint text-slate-800"}`}>Any</Link>
              {projects.map((item) => (
                <Link key={item.id} href={`/settings/users?project=${item.id}${shownOrg ? `&org=${shownOrg.id}` : ""}`}
                  className={`rounded-md px-2 py-1 font-semibold ${projectFilter === item.id ? "bg-tint text-slate-800" : "text-link hover:bg-tint-soft"}`}>
                  {item.code}
                </Link>
              ))}
            </>
          ) : null}
        </div>
        <DataTable head={<tr><Th>Person</Th><Th>Organization</Th><Th>Function on {project.code}</Th><Th>Department</Th><Th>Other projects</Th><Th></Th></tr>}>
          {shown.map((u) => {
            const here = u.memberships.find((m) => m.projectId === projectId);
            const elsewhere = u.memberships.filter((m) => m.projectId !== projectId);
            return (
              <tr key={u.id} id={`person-${u.id}`} className={u.active ? "scroll-mt-20 align-top target:bg-tint-soft" : "scroll-mt-20 align-top opacity-60 target:bg-tint-soft"}>
                <Td>
                  <span className="font-medium text-slate-800">{u.name}</span>{u.id === me.id ? <span className="ml-1 text-xs text-slate-500">(you)</span> : null}
                  <span className="block text-[11px] text-slate-500">
                    {u.email}{u.linked ? " · works here from their own DELIOS" : ""}{u.active ? "" : " · can no longer sign in"}
                  </span>
                </Td>
                <Td className="text-xs">{u.party?.name ?? u.organization ?? "—"}</Td>
                <Td className="text-xs">
                  {here ? here.function.name
                    : u.held?.pendingSince ? <span className="text-amber-700">{u.held.functionName} · waiting for {u.held.confirmerName ?? "management"} to confirm · <Link href="/people/confirm" className="font-semibold text-link hover:underline">People to confirm</Link></span>
                    : u.held?.refusedAt ? <span className="whitespace-pre-line text-red-700">{u.held.functionName} · refused by {u.held.refusedByName}: {u.held.refusedReason}</span>
                    : <span className="text-slate-600">not on {project.code}</span>}
                </Td>
                <Td className="text-xs">{here?.department ? deptLabel(here.department) : "—"}</Td>
                <Td className="text-xs">{elsewhere.length ? elsewhere.map((m) => `${m.project.code} · ${m.function.name}`).join(", ") : "—"}</Td>
                <Td>
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold text-link">Edit</summary>
                    <div className="mt-2 w-[min(85vw,34rem)] space-y-3">
                      <ActionForm action={savePersonAction} submitLabel="Save" size="sm" hidden={{ userId: u.id }}>
                        <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2">
                          {u.linked ? (
                            <p className="text-xs text-slate-600 sm:col-span-2">
                              {u.name} works here from their own organization&rsquo;s DELIOS: their name, email and sign-in are theirs.
                              Here you choose their function and department, or take them off {project.code}.
                            </p>
                          ) : (
                            <>
                              <Field label="Name" required><input name="name" required defaultValue={u.name} className={inputCls} /></Field>
                              <Field label="Email" required><input type="email" name="email" required defaultValue={u.email} className={inputCls} /></Field>
                              <Field label="Organization">
                                <select name="partyId" defaultValue={u.partyId ?? ""} className={inputCls}>
                                  <option value="">—</option>
                                  {parties.filter((p) => p.active || p.id === u.partyId).map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? "" : " (switched off)"}</option>)}
                                </select>
                              </Field>
                            </>
                          )}
                          <Field label={`Function on ${project.code}`} required={!here}>
                            <select name="functionId" defaultValue={here?.functionId ?? ""} className={inputCls}>
                              <option value="">{here ? "unchanged" : "Choose… (puts them on the project)"}</option>
                              {functionOptions}
                            </select>
                          </Field>
                          <Field label="Department" hint="their discipline: told about actions, confirms going ahead">
                            <select name="department" defaultValue={here?.department ?? ""} className={inputCls}>
                              <option value="">None</option>
                              {disciplines.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                            </select>
                          </Field>
                          {!here ? confirmerField : null}
                          {u.linked ? null : (
                            <label className="flex items-start gap-2 text-xs text-slate-600 sm:col-span-2">
                              <input type="checkbox" name="active" defaultChecked={u.active} className="mt-0.5" />
                              <span>Can sign in — untick to switch their account off on every project (to take them off {project.code} only, use the button below)</span>
                            </label>
                          )}
                        </div>
                      </ActionForm>
                      {here && u.id !== me.id ? (
                        <div className="border-t border-line pt-3">
                          <ActionForm action={takeOffProjectAction} submitLabel={`Take off ${project.code}`} size="sm" variant="secondary" hidden={{ userId: u.id }}
                            confirmText={`Take ${u.name} off ${project.code}? Their account and their other projects stay, and everything they did here keeps their name.`}>
                            <p className="text-xs text-slate-600">They leave this project only. Their account and their other projects stay.</p>
                          </ActionForm>
                        </div>
                      ) : null}
                    </div>
                  </details>
                </Td>
              </tr>
            );
          })}
        </DataTable>
      </Card>
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
