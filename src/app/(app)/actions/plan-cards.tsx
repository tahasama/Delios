import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { CalendarRange, ListChecks, Users, ArrowRight } from "lucide-react";
import { fmtDate } from "@/lib/utils";

/**
 * What the schedule side of the project rests on: the schedule itself, the
 * departments each activity concerns, and the documents they listed. Each is
 * changed by upload and takes effect once approved, so each card says where it
 * stands and opens the change from here — not from a settings page.
 */
const KINDS = [
  { kind: "SCHEDULE", title: "Project schedule", icon: CalendarRange, what: "Activities and their dates, imported from the planning tool.", level: "PROJECT" as const },
  { kind: "ACTION_DEPARTMENTS", title: "Departments per activity", icon: Users, what: "Which departments each activity concerns. The project manager fills and approves it.", level: "PROJECT" as const },
  { kind: "DOCUMENT_REQUIREMENTS", title: "Document requirements", icon: ListChecks, what: "What each activity needs, at which status, and by when.", level: "PROJECT" as const },
];

export async function PlanCards() {
  const ctx = await requireScope();
  const sets = await ctx.db.controlledSet.findMany({
    where: { kind: { in: KINDS.map((k) => k.kind) } },
    include: { versions: { orderBy: { createdAt: "desc" }, take: 20 } },
  });

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {KINDS.map(({ kind, title, icon: Icon, what }) => {
        const versions = sets.filter((s) => s.kind === kind && (s.projectId === null || s.projectId === ctx.projectId)).flatMap((s) => s.versions);
        const waiting = versions.filter((v) => v.state === "DRAFT" || v.state === "SUBMITTED");
        const inForce = versions.filter((v) => v.state === "APPROVED").sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0];
        return (
          <Link
            key={kind}
            href={`/admin/controlled/${kind}`}
            className="group rounded-2xl border border-slate-200 bg-surface p-4 shadow-sm transition hover:border-brand-line/40 hover:shadow"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-tint text-brand-ink"><Icon className="h-4 w-4" /></span>
              {title}
              <ArrowRight className="ml-auto h-3.5 w-3.5 text-slate-300 group-hover:text-link" />
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-500">{what}</p>
            <p className="mt-3 text-xs">
              {waiting.length ? (
                <span className="font-semibold text-amber-700">{waiting.length} change{waiting.length === 1 ? "" : "s"} waiting on a decision</span>
              ) : inForce ? (
                <span className="text-slate-500">In use now: <strong className="font-semibold text-slate-700">{inForce.versionLabel}</strong>{inForce.decidedAt ? ` · ${fmtDate(inForce.decidedAt)}` : ""}</span>
              ) : (
                <span className="text-slate-400">Nothing uploaded yet</span>
              )}
            </p>
          </Link>
        );
      })}
    </div>
  );
}
