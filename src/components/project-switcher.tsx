import { FolderOpen, Check, ChevronDown } from "lucide-react";
import { switchProjectAction } from "@/lib/actions/project";
import type { ProjectSummary } from "@/lib/scope";
import { ROLE_LABEL } from "@/lib/standard";
import type { Role } from "@/lib/standard";

/**
 * Which project am I in, and what else may I open? Sits at the top-left of every
 * screen because it is the frame for everything below it: a document number, an
 * action code and a transmittal number all mean something only within a project.
 */
export function ProjectSwitcher({
  current,
  available,
  role,
  functionName,
  organizationName,
}: {
  current: ProjectSummary;
  available: ProjectSummary[];
  role: Role;
  /** The job held on this project; the old role name only when there is none. */
  functionName?: string | null;
  organizationName: string;
}) {
  const single = available.length <= 1;

  if (single) {
    return (
      <div className="min-w-0 flex-1 border-slate-200 sm:min-w-[210px] sm:flex-none sm:border-r sm:pr-5">
        <p className="truncate text-sm font-semibold text-slate-800">{current.name}</p>
        <p className="truncate text-xs text-slate-400">
          {organizationName} · {functionName ?? ROLE_LABEL[role] ?? role}
        </p>
      </div>
    );
  }

  return (
    <details className="group relative min-w-0 flex-1 border-slate-200 sm:min-w-[210px] sm:flex-none sm:border-r sm:pr-5">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-1.5 outline-none transition hover:bg-slate-100 focus-visible:ring-3 focus-visible:ring-link/15">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-tint text-brand-ink">
          <FolderOpen className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-semibold leading-tight text-slate-800">{current.name}</span>
          <span className="block truncate text-[11px] leading-tight text-slate-400">
            {current.code} · {functionName ?? ROLE_LABEL[role] ?? role}
          </span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400 transition group-open:rotate-180" />
      </summary>

      <div className="absolute left-0 top-14 z-30 w-72 rounded-2xl border border-slate-200 bg-surface p-2 shadow-xl">
        <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          {organizationName}
        </p>
        {available.map((project) => {
          const active = project.id === current.id;
          return (
            <form key={project.id} action={switchProjectAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <button
                type="submit"
                aria-current={active ? "true" : undefined}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-slate-800">{project.name}</span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {project.code}
                    {project.kind !== "GENERIC" ? ` · ${project.kind.toLowerCase()}` : ""}
                  </span>
                </span>
                {active ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : null}
              </button>
            </form>
          );
        })}
      </div>
    </details>
  );
}
