import { Select } from "@/components/select";
import { Fragment } from "react";
import Link from "next/link";
import { Pencil, Plus, SlidersHorizontal, X } from "lucide-react";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { DataTable, Th, Td, Field, ToneChip } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { Asked, Added } from "@/components/policy-fields";
import { formPolicy } from "@/lib/settings/field-policy";
import { createProjectAction, saveProjectAction, setProjectStatusAction } from "@/lib/settings/forms-projects";
import { switchProjectAction } from "@/lib/settings/forms-project-switch";
import { cn, fmtDate } from "@/lib/core/utils";
import { projectKinds } from "@/lib/settings/project-kinds";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { adminProjects, adminUsers } from "@/lib/settings/api-admin";
import { projectSettings } from "@/lib/settings/api";
import { ProjectFields } from "@/app/(app)/settings/projects/project-fields";
import { joinedProjects } from "@/lib/organization/api";
import { JoinedProjects } from "../joined";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

/** Where a project stands: active, suspended (on hold) or archived, each said once. */
const STANDS = [
  { code: "ACTIVE", label: "Active", act: "Activate", tone: "done", said: "Activated", means: "Its people work on it as usual." },
  { code: "ON_HOLD", label: "Suspended", act: "Suspend", tone: "waiting", said: "Suspended", means: "Nobody opens it until it is activated again; its documents stay as they are." },
  { code: "ARCHIVED", label: "Archived", act: "Archive", tone: "idle", said: "Archived", means: "Put away with its documents; it leaves the picker. Nothing is deleted." },
] as const;

/** A field as on the new-document form: grey, no box, inside the sheet's `asking` body. */
const field = "plain w-full";

type Info = { kind?: string; startDate?: string; endDate?: string | null; scopeStatement?: string; description?: string | null };

/**
 * The organization's projects, in the reference style (People & access): the plate with how many are open and
 * archived; the table, each code and name opening that project, a pencil opening its line (the row goes on as the
 * form: grey fields, then Cancel and Save), Archive or Reopen inside the line, always with why; and "Open a new
 * project" as one sheet, which starts from the organization's defaults. The organization's, never a project's Settings
 * (which keeps only the project it is in). Administrators only.
 */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ edit?: string; new?: string; to?: string; p?: string }> }) {
  const scope = await requireOrgAdmin();
  const sp = await searchParams;
  const joined = await joinedProjects();
  const [policy, roleOptions, all, users] = await Promise.all([
    formPolicy({ orgId: scope.orgId, projectId: "" }, "PROJECT"), contractRoleOptions(), adminProjects().catch(() => []), adminUsers().catch(() => []),
  ]);
  /** I am on this project: its code and name open it. */
  const onIt = (id: string) => users.some((one) => one.id === scope.user.id && one.memberships.some((m) => m.active && m.projectId === id));

  const projects = await Promise.all(all
    // By code only: changing where a project stands never moves its line.
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(async (one) => {
      // Its type, dates and scope are the project's own answers, in its settings.
      let info: Info = {};
      try { info = JSON.parse((await projectSettings(one.id).catch(() => new Map<string, string>())).get("PROJECT_INFO") ?? "{}"); } catch { info = {}; }
      return { ...one, info, kind: one.kind ?? info.kind ?? "GENERIC", startDate: info.startDate ?? one.createdAt.slice(0, 10), endDate: info.endDate ?? null };
    }));
  const open = projects.filter((p) => p.status === "ACTIVE").length;
  const suspended = projects.filter((p) => p.status === "ON_HOLD").length;
  const archived = projects.filter((p) => p.status === "ARCHIVED").length;
  const openIds = new Set(projects.filter((p) => p.status === "ACTIVE").map((p) => p.id));
  const onOpen = users.filter((u) => u.internal && u.active && u.memberships.some((m) => m.active && openIds.has(m.projectId))).length;
  const kinds = await projectKinds();
  const kindLabel = kinds.label;
  const roleLabel = (code: string) => roleOptions.find((r) => r.code === code)?.label ?? code;
  const editing = sp.edit ?? null;
  const opening = sp.new === "1";

  const kindSelect = (value: string, required: boolean) => (
    <Select name="kind" required={required} defaultValue={value} className={field}>
      {kinds.offered.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
    </Select>
  );
  const roleSelect = (value: string, required: boolean) => (
    <Select name="role" required={required} defaultValue={value} className={field}>
      {roleOptions.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
    </Select>
  );
  const band = (title: string, said: string) => (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
      <span className="stencil mr-1 text-slate-500">{title}</span>
      <span className="text-[11px] text-slate-500">{said}</span>
    </div>
  );

  return (
    <>
      {/* The plate: what a project is here, its two acts, then the figures that matter across them. */}
      <header className="register register-sheet register-sheet-open">
        <div className="flex flex-col gap-4 px-5 pt-5 pb-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            <h1 className="plate-title text-slate-950">Projects</h1>
            <p className="plate-meta mt-1.5 max-w-xl font-normal">
              Each project keeps its own register, people and settings. Archiving puts one away; nothing is deleted.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link href="/organization/settings/flow" className="ask"><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Defaults for new projects</Link>
            {opening ? null : <Link href="/organization/projects?new=1#new" scroll={false} data-on="true" className="ask"><Plus className="h-3.5 w-3.5" aria-hidden="true" /> New project</Link>}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
          {[
            { term: "Open", value: open, said: open === 1 ? "project of ours" : "projects of ours" },
            { term: "Suspended", value: suspended, said: suspended ? "nobody works on them until activated" : "none suspended" },
            { term: "Archived", value: archived, said: archived ? "put away, kept whole" : "none put away" },
            { term: "People", value: onOpen, said: "of ours on an open project" },
          ].map((f) => (
            <div key={f.term} className="bg-surface px-5 py-3 sm:px-6">
              <dt className="stencil text-slate-500">{f.term}</dt>
              <dd className="mt-1 text-[13px] font-medium tabular-nums text-slate-900">{f.value}</dd>
              <dd className="text-[11px] text-slate-500">{f.said}</dd>
            </div>
          ))}
        </dl>
      </header>

      {/* A new project: one sheet, opened from the plate; it becomes the form. */}
      {opening ? (
      <section id="new" className="register register-sheet register-sheet-open scroll-mt-24" aria-label="New project">
        {band("New project", "it starts from the organization's defaults, which it then keeps as its own")}
        {opening ? (
          <>
            <ActionForm id="new-project" action={createProjectAction} hideSubmit resetOnSuccess className="asking space-y-5 px-5 py-5 sm:px-6">
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Field label="Project name" required><input name="name" required autoComplete="off" className={field} placeholder="North plant upgrade" /></Field>
                <Field label="Code" required hint="unique here; it starts every number"><input name="code" required autoComplete="off" className={`${field} uppercase`} placeholder="NP1" /></Field>
                <Asked policy={policy} field="kind" hint="describes the project; from Project types">{({ required }) => kindSelect("GENERIC", required)}</Asked>
                <Asked policy={policy} field="role" hint="decides where approval sits, and the matrix it starts from">{({ required }) => roleSelect("GENERIC", required)}</Asked>
                <Asked policy={policy} field="startDate">{({ required }) => <input type="date" name="startDate" required={required} className={field} />}</Asked>
                <Asked policy={policy} field="endDate" hint="planned completion">{({ required }) => <input type="date" name="endDate" required={required} className={field} />}</Asked>
                <Asked policy={policy} field="scopeStatement" hint="what it controls" className="sm:col-span-2">
                  {({ required }) => <input name="scopeStatement" required={required} className={field} placeholder="Leave blank for the standard wording" />}
                </Asked>
                <Field label="Description" hint="optional — what the project is about, in a few lines" className="sm:col-span-2">
                  <textarea name="description" rows={3} maxLength={2000} className={field} />
                </Field>
                <Added fields={policy.own} />
              </div>
              <details className="text-[11.5px] leading-[1.45] text-slate-600">
                <summary className="w-fit cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-800">Where approval sits under each role</summary>
                <dl className="mt-2 space-y-1.5">
                  {roleOptions.filter((r) => r.code !== "GENERIC").map((r) => (
                    <div key={r.code}>
                      <dt className="font-semibold text-slate-700">{r.label}</dt>
                      <dd className="text-slate-500">{r.approval}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Field label="Its people" hint="the same functions; take anyone off afterwards in People & access">
                  <Select name="copyFrom" defaultValue="" className={field}>
                    <option value="">Only you, to start</option>
                    {projects.filter((p) => p.status === "ACTIVE").map((p) => <option key={p.id} value={p.id}>Everyone on {p.code}</option>)}
                  </Select>
                </Field>
              </div>
            </ActionForm>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
              <Link href="/organization/projects" scroll={false} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-slate-500">Who does what and how it works come from the organization&rsquo;s defaults.</span>
                <button type="submit" form="new-project" data-on="true" className="ask">Open project</button>
              </div>
            </div>
          </>
        ) : null}
      </section>
      ) : null}

      {/* Every project: its code and name open it; the pencil opens its line. */}
      <section className="register register-sheet register-sheet-open" aria-labelledby="list-head">
        {band("Every project", `${projects.length} · type, dates and scope are each project's own`)}
        <DataTable className="rounded-none border-0 shadow-none" toolbar={false}
          head={<tr><Th>Project</Th><Th>Type</Th><Th>Our role</Th><Th>People</Th><Th>Documents</Th><Th>Start → planned end</Th><Th>Where it stands</Th><Th></Th></tr>}>
          {projects.map((p) => {
            const here = onIt(p.id);
            const active = p.status === "ACTIVE";
            const stands = STANDS.find((one) => one.code === p.status) ?? STANDS[0];
            const isOpen = editing === p.id;
            const changing = sp.p === p.id ? STANDS.find((one) => one.code === sp.to && one.code !== p.status) ?? null : null;
            const lineHref = (edit?: string) => `/organization/projects${edit ? `?edit=${edit}` : ""}#project-${p.id}`;
            const title = <><code className="code-chip mr-1.5">{p.code}</code><span className="font-medium">{p.name}</span></>;
            return (
              <Fragment key={p.id}>
                <tr id={`project-${p.id}`} className={cn("scroll-mt-20 align-top target:bg-tint-soft", !active && "opacity-60", isOpen && "[&>td]:border-b-0")}>
                  <Td>
                    {here && active ? (
                      <form action={switchProjectAction} className="inline">
                        <input type="hidden" name="projectId" value={p.id} />
                        <button type="submit" className="text-left text-slate-800 hover:text-link hover:underline" title={`Open ${p.code}`}>{title}</button>
                      </form>
                    ) : <span className="text-slate-800">{title}</span>}
                    {!here ? <span className="ml-1.5 text-[11px] text-slate-500">(you are not on it)</span> : null}
                    {p.codeChangedAt ? <span className="block text-[11px] text-slate-500">was {p.previousCode}</span> : null}
                    {p.info.description ? <span className="mt-0.5 block max-w-md truncate text-[11px] text-slate-500" title={p.info.description}>{p.info.description}</span> : null}
                    {p.statusReason ? (
                      <span className="block text-[11px] whitespace-pre-line text-slate-500">
                        {stands.said}{p.statusChangedAt ? ` ${fmtDate(p.statusChangedAt)}` : ""}{p.statusChangedByName ? ` by ${p.statusChangedByName}` : ""}: {p.statusReason}
                      </span>
                    ) : null}
                  </Td>
                  <Td className="text-xs">{kindLabel(p.kind)}</Td>
                  <Td className="text-xs">{p.contractRole === "GENERIC" ? <span className="text-slate-500">not stated</span> : roleLabel(p.contractRole)}</Td>
                  <Td className="text-xs tabular-nums">{p.members}</Td>
                  <Td className="text-xs tabular-nums">{p.documents}</Td>
                  <Td className="text-xs whitespace-nowrap">
                    {fmtDate(p.startDate)} <span className="text-slate-400">→</span> {p.endDate ? fmtDate(p.endDate) : <span className="text-slate-500">not set</span>}
                  </Td>
                  <Td className="w-px whitespace-nowrap">
                    {/* Where it stands, changed right here: choosing another asks only why, under the line. */}
                    <nav aria-label={`Where ${p.code} stands`} className="seg w-fit">
                      {STANDS.map((one) => one.code === p.status
                        ? <span key={one.code} aria-current="page" className="segment">{one.label}</span>
                        : <Link key={one.code} href={`/organization/projects?p=${p.id}&to=${one.code}#project-${p.id}`} scroll={false} className="segment">{one.label}</Link>)}
                    </nav>
                  </Td>
                  <Td className="w-px whitespace-nowrap text-right">
                    {isOpen ? (
                      <Link href={lineHref()} scroll={false} className="inline-flex rounded-sm p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Close">
                        <X aria-label={`Close ${p.code}`} className="h-4 w-4" />
                      </Link>
                    ) : (
                      <Link href={lineHref(p.id)} scroll={false} className="inline-flex rounded-sm p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title={`Change ${p.code}`}>
                        <Pencil aria-label={`Change ${p.code}`} className="h-4 w-4" />
                      </Link>
                    )}
                  </Td>
                </tr>
                {changing ? (
                  // Another state chosen on the line: only why is asked, under it, then it is done.
                  <tr>
                    <td colSpan={8} className="border-b border-line bg-tint-soft p-0">
                      <ActionForm action={setProjectStatusAction} hideSubmit hidden={{ projectId: p.id, status: changing.code }}
                        className="asking flex flex-wrap items-end gap-x-6 gap-y-3 px-5 py-4 sm:px-6">
                        <div className="min-w-0 max-w-sm">
                          <p className="text-[13px] font-semibold text-slate-900">{changing.act} {p.code}</p>
                          <p className="mt-0.5 text-xs leading-5 text-slate-600">{changing.means}</p>
                        </div>
                        <Field label="Why" required hint="kept on the project's line and in the audit trail" className="min-w-64 flex-1">
                          <input name="reason" required autoFocus className={field} />
                        </Field>
                        <div className="flex items-center gap-3">
                          <Link href={`/organization/projects#project-${p.id}`} scroll={false} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
                          <button type="submit" data-on="true" className="ask">{changing.act}</button>
                        </div>
                      </ActionForm>
                    </td>
                  </tr>
                ) : null}
                {isOpen ? (
                  // The project's line opened under it: the row itself goes on, the new-document form's way.
                  <tr>
                    <td colSpan={8} className="border-b border-line p-0">
                      <ActionForm id={`project-form-${p.id}`} action={saveProjectAction} hideSubmit hidden={{ projectId: p.id }}
                        className="asking space-y-5 px-5 py-5 sm:px-6">
                        <ProjectFields p={{ ...p, scopeStatement: p.info.scopeStatement, description: p.info.description ?? undefined }} roles={roleOptions} kinds={kinds.offered} />
                      </ActionForm>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
                        <Link href={lineHref()} scroll={false} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
                        <button type="submit" form={`project-form-${p.id}`} data-on="true" className="ask">Save</button>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </DataTable>
      </section>
      <JoinedProjects scope={scope} joined={joined} roleLabel={(code) => (code ? roleLabel(code) : null)}
        ours={users.filter((u) => u.internal).map((u) => ({ id: u.id, name: u.name, active: u.active }))} />
      </>
  );
}
