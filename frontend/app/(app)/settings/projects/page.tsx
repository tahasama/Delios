import Link from "next/link";
import { Pencil } from "lucide-react";
import { requireScope } from "@/lib/core/scope";
import { isAdmin } from "@/lib/core/auth";
import { ActionForm } from "@/components/form";
import { ToneChip } from "@/components/ui";
import { saveProjectAction } from "@/lib/settings/forms-projects";
import { fmtDate } from "@/lib/core/utils";
import { PROJECT_KINDS } from "@/lib/settings/profiles/kinds";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { adminProjects } from "@/lib/settings/api-admin";
import { projectSettings } from "@/lib/settings/api";
import { NoAccess } from "../no-access";
import { ProjectFields } from "./project-fields";

export const dynamic = "force-dynamic";
export const metadata = { title: "This project" };

type Info = { kind?: string; startDate?: string; endDate?: string | null; scopeStatement?: string; description?: string | null };

/**
 * Settings → This project: the project one is in, and only it (its name, type, our role, dates, scope; its code,
 * changed once in its life). Opening a project, archiving or reopening one, and the list of every project are the
 * organization's (`/organization/projects`). Administrators only.
 */
export default async function ThisProjectPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireScope();
  if (!isAdmin(ctx.user)) return <NoAccess title="This project" who="admin" />;
  const sp = await searchParams;
  const [roles, all, settings] = await Promise.all([
    contractRoleOptions(), adminProjects().catch(() => []), projectSettings(ctx.projectId).catch(() => new Map<string, string>()),
  ]);
  const one = all.find((p) => p.id === ctx.projectId);
  let info: Info = {};
  try { info = JSON.parse(settings.get("PROJECT_INFO") ?? "{}"); } catch { info = {}; }
  if (!one) return <NoAccess title="This project" who="admin" />;
  const p = {
    ...one, kind: one.kind ?? info.kind ?? "GENERIC", startDate: info.startDate ?? one.createdAt.slice(0, 10), endDate: info.endDate ?? null,
    scopeStatement: info.scopeStatement, description: info.description ?? undefined,
  };
  const editing = sp.edit === "1";
  const kindLabel = PROJECT_KINDS.find((k) => k.code === p.kind)?.label ?? p.kind.toLowerCase();
  const roleLabel = p.contractRole === "GENERIC" ? "not stated" : roles.find((r) => r.code === p.contractRole)?.label ?? p.contractRole;
  const lines: [string, React.ReactNode][] = [
    ["Name", p.name],
    ["Code", <>{p.code}<span className="ml-1.5 text-[11px] text-slate-500">
      {p.codeChangedAt ? `fixed: changed once, from ${p.previousCode}, by ${p.codeChangedByName}, ${fmtDate(p.codeChangedAt)}` : "may be changed once, for a mistake"}
    </span></>],
    ["Type", kindLabel],
    ["Our role", roleLabel],
    ["Dates", <>{fmtDate(p.startDate)}{p.endDate ? ` to ${fmtDate(p.endDate)}` : ""}</>],
    ["Description", p.description ? <span className="whitespace-pre-line">{p.description}</span> : <span className="text-slate-500">none yet</span>],
    ["Scope", p.scopeStatement || "the standard wording"],
    ["People · documents", `${p.members} · ${p.documents}`],
  ];

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 pt-6 pb-4 sm:px-6">
          <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{p.code}</p>
          <h1 className="plate-title mt-1 text-slate-950">{p.name}</h1>
          <p className="plate-meta mt-2 flex items-center gap-2">
            {p.status === "ARCHIVED" ? <ToneChip tone="idle">archived</ToneChip> : <ToneChip tone="done">open</ToneChip>}
            <span>since {fmtDate(p.startDate)}</span>
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            What {p.code} is. Its code and name are its own across DELIOS, never given to another project. Opening a new
            project, archiving or reopening one, and every project of the organization are on the{" "}
            <Link href="/organization/projects" className="font-semibold text-link hover:underline">organization&rsquo;s Projects</Link>.
          </p>
        </div>
      </section>

      <section id="project" className="register register-sheet register-sheet-open scroll-mt-24" aria-labelledby="project-head">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span id="project-head" className="stencil mr-1 text-slate-500">The project</span>
          <span className="text-[11px] text-slate-500">numbers already given keep the code they were given with</span>
          {editing ? null : (
            <Link href="/settings/projects?edit=1#project" scroll={false} className="ml-auto inline-flex rounded-sm p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title={`Change ${p.code}`}>
              <Pencil aria-label={`Change ${p.code}`} className="h-4 w-4" />
            </Link>
          )}
        </div>
        {editing ? (
          <>
            <ActionForm id="this-project" action={saveProjectAction} hideSubmit hidden={{ projectId: p.id }} className="asking space-y-5 px-5 py-5 sm:px-6">
              <ProjectFields p={p} roles={roles} />
            </ActionForm>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
              <Link href="/settings/projects" scroll={false} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
              <button type="submit" form="this-project" data-on="true" className="ask">Save</button>
            </div>
          </>
        ) : (
          <dl className="divide-y divide-line">
            {lines.map(([label, value]) => (
              <div key={label} className="grid grid-cols-1 gap-1 px-5 py-2.5 text-[13px] sm:grid-cols-[180px_minmax(0,1fr)] sm:px-6">
                <dt className="text-xs font-semibold text-slate-500">{label}</dt>
                <dd className="text-slate-800">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
