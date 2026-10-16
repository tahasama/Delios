import { Fragment } from "react";
import Link from "next/link";
import { Pencil, X } from "lucide-react";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { DataTable, Th, Td, Field, ToneChip } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { Asked, Added } from "@/components/policy-fields";
import { formPolicy } from "@/lib/settings/field-policy";
import { createProjectAction, saveProjectAction, setProjectStatusAction } from "@/lib/settings/forms-projects";
import { switchProjectAction } from "@/lib/settings/forms-project-switch";
import { cn, fmtDate } from "@/lib/core/utils";
import { PROJECT_KINDS } from "@/lib/settings/profiles/kinds";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { adminProjects, adminUsers } from "@/lib/settings/api-admin";
import { projectSettings } from "@/lib/settings/api";
import { ProjectFields } from "@/app/(app)/settings/projects/project-fields";
import { OrgHeader } from "../org-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

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
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ edit?: string; new?: string }> }) {
  const scope = await requireOrgAdmin();
  const sp = await searchParams;
  const [policy, roleOptions, all, users] = await Promise.all([
    formPolicy({ orgId: scope.orgId, projectId: "" }, "PROJECT"), contractRoleOptions(), adminProjects().catch(() => []), adminUsers().catch(() => []),
  ]);
  /** I am on this project: its code and name open it. */
  const onIt = (id: string) => users.some((one) => one.id === scope.user.id && one.memberships.some((m) => m.active && m.projectId === id));

  const projects = await Promise.all(all
    .sort((a, b) => a.status.localeCompare(b.status) || a.code.localeCompare(b.code))
    .map(async (one) => {
      // Its type, dates and scope are the project's own answers, in its settings.
      let info: Info = {};
      try { info = JSON.parse((await projectSettings(one.id).catch(() => new Map<string, string>())).get("PROJECT_INFO") ?? "{}"); } catch { info = {}; }
      return { ...one, info, kind: one.kind ?? info.kind ?? "GENERIC", startDate: info.startDate ?? one.createdAt.slice(0, 10), endDate: info.endDate ?? null };
    }));
  const open = projects.filter((p) => p.status !== "ARCHIVED").length;
  const archived = projects.length - open;
  const kindLabel = (code: string) => PROJECT_KINDS.find((k) => k.code === code)?.label ?? code.toLowerCase();
  const roleLabel = (code: string) => roleOptions.find((r) => r.code === code)?.label ?? code;
  const editing = sp.edit ?? null;
  const opening = sp.new === "1";

  const kindSelect = (value: string, required: boolean) => (
    <select name="kind" required={required} defaultValue={value} className={field}>
      {PROJECT_KINDS.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
    </select>
  );
  const roleSelect = (value: string, required: boolean) => (
    <select name="role" required={required} defaultValue={value} className={field}>
      {roleOptions.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
    </select>
  );
  const band = (title: string, said: string) => (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
      <span className="stencil mr-1 text-slate-500">{title}</span>
      <span className="text-[11px] text-slate-500">{said}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas">
      <OrgHeader scope={scope} back={{ href: "/organization", label: "Organization" }} />
      <main className="mx-auto max-w-6xl space-y-4 px-6 py-6">
      {/* The plate: how many projects, and what a project is made of. */}
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 pt-6 pb-4 sm:px-6">
          <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{scope.organization.name}</p>
          <h1 className="plate-title mt-1 text-slate-950">Projects</h1>
          <p className="plate-meta mt-2">
            {open} open{archived ? <> · {archived} archived</> : null}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            Each project has its own register, number counters, people and settings. A new one starts from the
            organization&rsquo;s <Link href="/organization/defaults" className="font-semibold text-link hover:underline">defaults for new projects</Link>;
            what is changed on a project changes that project only. A project&rsquo;s code and name are its own across DELIOS and never
            given to another; its code changes once, for a mistake. Archiving puts its documents away with it; nothing is deleted.
          </p>
        </div>
      </section>

      {/* Open a new project: one sheet; opened, it becomes the form. */}
      <section id="new" className="register register-sheet register-sheet-open scroll-mt-24" aria-label="Open a new project">
        {band("Open a new project", "it starts from the organization's defaults, which it then keeps as its own")}
        {opening ? (
          <>
            <ActionForm id="new-project" action={createProjectAction} hideSubmit resetOnSuccess className="asking space-y-5 px-5 py-5 sm:px-6">
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Field label="Project name" required><input name="name" required autoComplete="off" className={field} placeholder="North plant upgrade" /></Field>
                <Field label="Code" required hint="unique here; it starts every number"><input name="code" required autoComplete="off" className={`${field} uppercase`} placeholder="NP1" /></Field>
                <Asked policy={policy} field="kind" hint="affects defaults only, never the rules">{({ required }) => kindSelect("GENERIC", required)}</Asked>
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
                  <select name="copyFrom" defaultValue="" className={field}>
                    <option value="">Only you, to start</option>
                    {projects.filter((p) => p.status !== "ARCHIVED").map((p) => <option key={p.id} value={p.id}>Everyone on {p.code}</option>)}
                  </select>
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
        ) : (
          <div className="px-5 py-4 sm:px-6">
            <Link href="/organization/projects?new=1#new" scroll={false} className="ask w-fit">Open a new project</Link>
          </div>
        )}
      </section>

      {/* Every project: its code and name open it; the pencil opens its line. */}
      <section className="register register-sheet register-sheet-open" aria-labelledby="list-head">
        {band("Every project", `${projects.length} · type, dates and scope are each project's own`)}
        <DataTable className="rounded-none border-0 shadow-none" toolbar={false}
          head={<tr><Th>Project</Th><Th>Type</Th><Th>Our role</Th><Th>People</Th><Th>Documents</Th><Th>Dates</Th><Th>Status</Th><Th></Th></tr>}>
          {projects.map((p) => {
            const here = onIt(p.id);
            const active = p.status !== "ARCHIVED";
            const isOpen = editing === p.id;
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
                        {active ? "Reopened" : "Archived"}{p.statusChangedAt ? ` ${fmtDate(p.statusChangedAt)}` : ""}{p.statusChangedByName ? ` by ${p.statusChangedByName}` : ""}: {p.statusReason}
                      </span>
                    ) : null}
                  </Td>
                  <Td className="text-xs">{kindLabel(p.kind)}</Td>
                  <Td className="text-xs">{p.contractRole === "GENERIC" ? <span className="text-slate-500">not stated</span> : roleLabel(p.contractRole)}</Td>
                  <Td className="text-xs tabular-nums">{p.members}</Td>
                  <Td className="text-xs tabular-nums">{p.documents}</Td>
                  <Td className="text-xs whitespace-nowrap">
                    {fmtDate(p.startDate)}
                    {p.endDate ? <span className="block text-slate-500">to {fmtDate(p.endDate)}</span> : null}
                  </Td>
                  <Td>{active ? <ToneChip tone="done">open</ToneChip> : <ToneChip tone="idle">archived</ToneChip>}</Td>
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
                {isOpen ? (
                  // The project's line opened under it: the row itself goes on, the new-document form's way.
                  <tr>
                    <td colSpan={8} className="border-b border-line p-0">
                      <ActionForm id={`project-form-${p.id}`} action={saveProjectAction} hideSubmit hidden={{ projectId: p.id }}
                        className="asking space-y-5 px-5 py-5 sm:px-6">
                        <ProjectFields p={{ ...p, scopeStatement: p.info.scopeStatement, description: p.info.description ?? undefined }} roles={roleOptions} />
                      </ActionForm>
                      <details className="border-t border-line px-5 py-3 sm:px-6">
                        <summary className="w-fit cursor-pointer list-none text-xs font-semibold text-slate-500 hover:text-slate-800 [&::-webkit-details-marker]:hidden">
                          {active ? `Archive ${p.code}` : `Reopen ${p.code}`}
                        </summary>
                        <ActionForm action={setProjectStatusAction} hideSubmit hidden={{ projectId: p.id, status: active ? "ARCHIVED" : "ACTIVE" }}
                          className="asking mt-3 space-y-3"
                          confirmText={active ? `Archive ${p.code}? Its documents are put away with it and it leaves the picker. Nothing is deleted.` : undefined}>
                          <p className="text-xs leading-5 text-slate-600">
                            {active
                              ? `Its documents are archived with it and it leaves the project picker. Nothing is deleted; reopening brings everything back.`
                              : `Its documents come back as they were, and it is in the project picker again.`}
                          </p>
                          <Field label="Why" required hint="kept on the project's line and in the audit trail">
                            <textarea name="reason" required rows={2} className={field} />
                          </Field>
                          <button type="submit" className="ask">{active ? "Archive it" : "Reopen it"}</button>
                        </ActionForm>
                      </details>
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
      </main>
    </div>
  );
}
