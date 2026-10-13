import { requireScope } from "@/lib/scope";
import { isAdmin } from "@/lib/auth";
import { PageHeader, Card, Chip, DataTable, Th, Td, Field, btn, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { Asked, Added } from "@/components/policy-fields";
import { formPolicy } from "@/lib/field-policy";
import { createProjectAction, renameProjectAction, setProjectStatusAction, openProjectAction } from "@/lib/actions/projects";
import { fmtDate } from "@/lib/utils";
import { FolderOpen, ArrowRight } from "lucide-react";
import { PROJECT_KINDS } from "@/lib/profiles/kinds";
import { contractRoleOptions } from "@/lib/contract-roles";
import { adminProjects } from "@/lib/api/admin";
import { projectSettings } from "@/lib/api/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

const KINDS = PROJECT_KINDS;

export default async function ProjectsPage() {
  const ctx = await requireScope();
  const policy = await formPolicy(ctx, "PROJECT");
  const { user: me, projectId } = ctx;
  if (!isAdmin(me)) return <PageHeader title="Projects" subtitle="Administrators only." />;

  const roleOptions = await contractRoleOptions();
  const projects = await Promise.all((await adminProjects())
    .sort((a, b) => a.status.localeCompare(b.status) || a.code.localeCompare(b.code))
    .map(async (one) => {
      // Its type and dates are the project's own answers, in its settings.
      let info: { kind?: string; startDate?: string; endDate?: string | null } = {};
      try { info = JSON.parse((await projectSettings(one.id).catch(() => new Map<string, string>())).get("PROJECT_INFO") ?? "{}"); } catch { info = {}; }
      return {
        ...one, kind: info.kind ?? "GENERIC", role: one.contractRole, startDate: new Date(info.startDate ?? one.createdAt),
        endDate: info.endDate ? new Date(info.endDate) : null, _count: { members: one.members, documents: one.documents, actions: 0 },
      };
    }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Projects"
        subtitle="Each project has its own documents and number sequences. Lists, numbering and permissions are shared across projects."
      />


      <Card title={`Projects (${projects.length})`}>
        <DataTable
          head={
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Our role</Th>
              <Th>People</Th>
              <Th>Documents</Th>
              <Th>Started</Th>
              <Th>Status</Th>
              <Th></Th>
            </tr>
          }
        >
          {projects.map((p) => (
            <tr key={p.id} className={p.status === "ACTIVE" ? "" : "opacity-55"}>
              <Td className="font-mono text-xs font-semibold">{p.code}</Td>
              <Td>
                {p.name}
                {p.id === projectId ? <span className="ml-1.5 text-[11px] text-emerald-700">(open now)</span> : null}
              </Td>
              <Td className="text-xs text-slate-500">{p.kind.toLowerCase()}</Td>
              <Td className="text-xs text-slate-500">{p.role === "GENERIC" ? <span className="text-slate-300">not stated</span> : p.role}</Td>
              <Td className="tabular-nums">{p._count.members}</Td>
              <Td className="tabular-nums">{p._count.documents}</Td>
              <Td className="whitespace-nowrap text-xs text-slate-400">
                {fmtDate(p.startDate)}
                {p.endDate ? <span className="block text-slate-300">to {fmtDate(p.endDate)}</span> : null}
              </Td>
              <Td>
                {p.status === "ACTIVE" ? (
                  <Chip className="bg-emerald-100 text-emerald-800 ring-emerald-300">active</Chip>
                ) : (
                  <Chip className="bg-slate-100 text-slate-500 ring-slate-300">archived</Chip>
                )}
              </Td>
              <Td>
                <div className="flex items-center gap-2">
                  {p.status === "ACTIVE" && p.id !== projectId ? (
                    <form action={openProjectAction}>
                      <input type="hidden" name="projectId" value={p.id} />
                      <button type="submit" className={btn("secondary", "sm")}>
                        Open <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  ) : null}
                  <details className="w-full">
                    <summary className="cursor-pointer text-xs font-semibold text-link">Rename</summary>
                    <div className="mt-2 rounded-xl border border-line bg-tint-soft p-3">
                      <p className="mb-2 text-[11px] leading-4 text-amber-800">
                        The code is part of every number already given out. Changing it does not renumber anything:
                        documents keep the code they were created with, and only new numbers use the new one. Reports and
                        saved searches that name the old code keep working.
                      </p>
                      <ActionForm action={renameProjectAction} submitLabel="Save" size="sm" hidden={{ projectId: p.id }}>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
                          <Field label="Project name" required><input name="name" required defaultValue={p.name} className={inputCls} /></Field>
                          <Field label="Code" required><input name="code" required defaultValue={p.code} className={`${inputCls} uppercase`} /></Field>
                        </div>
                      </ActionForm>
                    </div>
                  </details>
                  <ActionForm
                    action={setProjectStatusAction}
                    submitLabel={p.status === "ACTIVE" ? "Archive" : "Reopen"}
                    variant="secondary"
                    size="sm"
                    hidden={{ projectId: p.id, status: p.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" }}
                    confirmText={
                      p.status === "ACTIVE"
                        ? `Archive ${p.code}? It disappears from the picker. Nothing in its register is deleted.`
                        : undefined
                    }
                    className="space-y-0"
                  />
                </div>
              </Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <details className="rounded-2xl border border-line bg-surface px-5 py-3 shadow-sm"><summary className="cursor-pointer text-sm font-semibold text-brand-ink">+ Open a new project</summary><div className="mt-3 max-w-2xl">
        <ActionForm action={createProjectAction} submitLabel="Open project" resetOnSuccess>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_150px]">
            <Field label="Project name" required>
              <input name="name" required className={inputCls} placeholder="North plant upgrade" />
            </Field>
            <Field label="Code" required hint="Unique here">
              <input name="code" required className={`${inputCls} uppercase`} placeholder="NP1" />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Asked policy={policy} field="kind" hint="Affects defaults only, never the rules">
              {({ required }) => (
                <select name="kind" required={required} className={inputCls} defaultValue="GENERIC">
                  {KINDS.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
                </select>
              )}
            </Asked>
            <Asked policy={policy} field="role" hint="Decides where approval sits, and the matrix it starts from">
              {({ required }) => (
                <select name="role" required={required} className={inputCls} defaultValue="GENERIC">
                  {roleOptions.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                </select>
              )}
            </Asked>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Asked policy={policy} field="startDate">
              {({ required }) => <input type="date" name="startDate" required={required} className={inputCls} />}
            </Asked>
            <Asked policy={policy} field="endDate" hint="Planned completion">
              {({ required }) => <input type="date" name="endDate" required={required} className={inputCls} />}
            </Asked>
          </div>
          <details className="rounded-xl border border-line bg-tint-soft px-3 py-2 text-[11.5px] leading-[1.45] text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">Where approval sits under each role</summary>
            <dl className="mt-2 space-y-1.5">
              {roleOptions.filter((r) => r.code !== "GENERIC").map((r) => (
                <div key={r.code}>
                  <dt className="font-semibold text-slate-700">{r.label}</dt>
                  <dd className="text-slate-500">{r.approval}</dd>
                </div>
              ))}
            </dl>
          </details>
          <Asked policy={policy} field="scopeStatement" className="sm:col-span-2">{({ required }) => (<span className="block">
            <input
              name="scopeStatement"
              className={inputCls}
              placeholder="Leave blank for the standard wording"
            />
          </span>)}</Asked>
          <label className="flex items-start gap-2 text-xs text-slate-600">
            <input type="checkbox" name="copyPeople" className="mt-0.5" defaultChecked />
            <span>
              Carry over everyone on <span className="font-medium">{ctx.project.code}</span>, with the same functions.
              You can prune the team afterwards in People &amp; access.
            </span>
          </label>
          <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
            <FolderOpen className="mt-0.5 h-3 w-3 shrink-0" />
            Value sets, numbering schemes and the permission matrix are shared — the new project uses them immediately.
          </p>
          <Added fields={policy.own} className="sm:col-span-2" />
        </ActionForm>
      </div></details>
    </div>
  );
}
