import { requireScope } from "@/lib/scope";
import { isAdmin } from "@/lib/auth";
import { PageHeader, Card, Chip, DataTable, Th, Td, Field, btn, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { createProjectAction, renameProjectAction, setProjectStatusAction, openProjectAction } from "@/lib/actions/projects";
import { fmtDate } from "@/lib/utils";
import { FolderOpen, ArrowRight } from "lucide-react";
import { PROJECT_KINDS } from "@/lib/profiles/kinds";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

const KINDS = PROJECT_KINDS;

export default async function ProjectsPage() {
  const ctx = await requireScope();
  const { db, user: me, orgId, projectId } = ctx;
  if (!isAdmin(me)) return <PageHeader title="Projects" subtitle="Administrators only." />;

  const projects = await db.project.findMany({
    where: { orgId },
    orderBy: [{ status: "asc" }, { code: "asc" }],
    include: {
      _count: { select: { members: true, documents: true, actions: true } },
    },
  });

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
              <Td className="tabular-nums">{p._count.members}</Td>
              <Td className="tabular-nums">{p._count.documents}</Td>
              <Td className="whitespace-nowrap text-xs text-slate-400">{fmtDate(p.startDate)}</Td>
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
                    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
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

      <details className="rounded-2xl border border-slate-200 bg-surface px-5 py-3 shadow-sm"><summary className="cursor-pointer text-sm font-semibold text-brand-ink">+ Open a new project</summary><div className="mt-3 max-w-2xl">
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
            <Field label="Type" hint="Affects defaults only, never the rules">
              <select name="kind" className={inputCls} defaultValue="GENERIC">
                {KINDS.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
              </select>
            </Field>
            <Field label="Start date">
              <input type="date" name="startDate" className={inputCls} />
            </Field>
          </div>
          <Field label="Scope statement" hint="What this project's conformance figure is measured against">
            <input
              name="scopeStatement"
              className={inputCls}
              placeholder="Leave blank for the standard wording"
            />
          </Field>
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
        </ActionForm>
      </div></details>
    </div>
  );
}
