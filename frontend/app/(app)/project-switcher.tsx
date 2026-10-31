import { FolderOpen, Check, ChevronDown } from "lucide-react";
import { switchProjectAction } from "@/lib/settings/forms-project-switch";
import { switchOrganizationAction } from "@/lib/organization/forms";
import type { Elsewhere } from "@/lib/organization/api";
import type { ProjectSummary } from "@/lib/core/scope";
import { roleFor } from "@/lib/settings/profiles/roles";

/**
 * Which project am I in, and what else may I open? Sits at the top-left of every
 * screen because it is the frame for everything below it: a document number, an
 * action code and a transmittal number all mean something only within a project.
 *
 * Its name, and its code faded beside it: nothing more (owner: who you are and what we are on it, you know already).
 */
export function ProjectSwitcher({
  current,
  available,
  organizationName,
  elsewhere = [],
}: {
  current: ProjectSummary;
  available: ProjectSummary[];
  organizationName: string;
  /** Other organizations' projects this person is on (with their own sign-in), or the way back home. */
  elsewhere?: Elsewhere[];
}) {
  const single = available.length <= 1 && elsewhere.length === 0;

  if (single) {
    return (
      <p title={`${current.name} · ${current.code}`} className="flex min-w-0 flex-1 items-baseline gap-2 border-line sm:max-w-80 sm:flex-none sm:border-r sm:pr-5">
        <span className="truncate text-sm font-semibold text-slate-900">{current.name}</span>
        <span className="shrink-0 font-mono text-xs text-slate-500">{current.code}</span>
      </p>
    );
  }

  return (
    <details data-menu className="group relative min-w-0 flex-1 border-line sm:max-w-80 sm:flex-none sm:border-r sm:pr-5">
      <summary title={`${current.name} · ${current.code}`} className="flex h-(--control-h) cursor-pointer list-none items-center gap-2 rounded-lg px-2 outline-none transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-link/30 group-open:bg-slate-100">
        <FolderOpen className="h-4 w-4 shrink-0 text-slate-500" />
        <span className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
          <span className="truncate text-sm font-semibold text-slate-800">{current.name}</span>
          <span className="shrink-0 font-mono text-xs text-slate-500">{current.code}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400 transition group-open:rotate-180" />
      </summary>

      <div className="scroll-thin absolute left-0 top-11 z-30 max-h-[min(70dvh,32rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-[0_12px_32px_-8px_rgb(16_42_67/0.25)]">
        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-slate-500">
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
                  {project.role !== "GENERIC" ? (
                    <span className="block truncate text-[11px] text-slate-500" title={roleFor(project.role)?.approval}>
                      we are {roleFor(project.role)?.label ?? project.role}
                    </span>
                  ) : null}
                </span>
                {active ? <Check className="h-4 w-4 shrink-0 text-brand-ink" /> : null}
              </button>
            </form>
          );
        })}
        {/* Projects of other organizations' this person works on with their own sign-in, and the way back home. */}
        {elsewhere.map((other) => (
          <div key={other.tenantId} className="mt-1 border-t border-line pt-1">
            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-slate-500">
              {other.home ? `Back to ${other.organization}` : other.organization}
            </p>
            {other.home && !other.projects.length ? (
              <form action={switchOrganizationAction}>
                <input type="hidden" name="tenantId" value={other.tenantId} />
                <button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-slate-800 transition hover:bg-slate-50">
                  {other.organization}
                </button>
              </form>
            ) : null}
            {other.projects.map((project) => (
              <form key={project.id} action={switchOrganizationAction}>
                <input type="hidden" name="tenantId" value={other.tenantId} />
                <input type="hidden" name="projectId" value={project.id} />
                <button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-800">{project.name}</span>
                    <span className="block truncate text-[11px] text-slate-400">{project.code}</span>
                  </span>
                </button>
              </form>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
