import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, Banner } from "@/components/ui";
import { allHandlers, summariseDiff, type DiffLine } from "@/lib/controlled/registry";
import "@/lib/controlled/handlers";
import { fmtDate } from "@/lib/utils";
import { Grid3X3, CalendarRange, Tags, ArrowRight, CircleCheck, Clock, PencilLine } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Controlled changes" };

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  DISTRIBUTION_MATRIX: Grid3X3,
  SCHEDULE: CalendarRange,
  VALUE_SET: Tags,
};

function parseDiff(json: string | null): DiffLine[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    return Array.isArray(raw) ? (raw as DiffLine[]) : [];
  } catch {
    return [];
  }
}

export default async function ControlledPage() {
  const ctx = await requireScope();
  const { db } = ctx;

  const mayChange = ctx.can("CONFIGURE") || ctx.can("CONTROL");
  if (!mayChange && !ctx.can("CONFIGURE")) {
    return <PageHeader title="Controlled changes" subtitle={ctx.why("CONFIGURE")} />;
  }

  const handlers = allHandlers();
  const sets = await db.controlledSet.findMany({
    include: { versions: { orderBy: { createdAt: "desc" }, take: 20 } },
  });

  const cards = handlers.map((handler) => {
    const mine = sets.filter(
      (s) => s.kind === handler.kind && (handler.level === "ORG" ? s.projectId === null : s.projectId === ctx.projectId),
    );
    const versions = mine.flatMap((s) => s.versions);
    const pending = versions.filter((v) => v.state === "DRAFT" || v.state === "SUBMITTED");
    const inForce = versions
      .filter((v) => v.state === "APPROVED")
      .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0];
    return { handler, pending, inForce, total: versions.length };
  });

  const waiting = cards.reduce((n, c) => n + c.pending.filter((p) => p.state === "SUBMITTED").length, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Controlled changes"
        subtitle="Configuration that arrives as a file: uploaded, compared against what is in force, and approved by someone other than whoever sent it."
      />

      {waiting > 0 ? (
        <Banner tone="warn" title={`${waiting} change${waiting === 1 ? "" : "s"} waiting on a decision`}>
          Nothing below has taken effect. Open the card to see exactly what each one would change.
        </Banner>
      ) : (
        null
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ handler, pending, inForce, total }) => {
          const Icon = ICON[handler.kind] ?? Grid3X3;
          const submitted = pending.find((p) => p.state === "SUBMITTED");
          const draft = pending.find((p) => p.state === "DRAFT");

          return (
            <Link
              key={handler.kind}
              href={`/admin/controlled/${handler.kind}`}
              className="group flex flex-col rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm outline-none transition hover:border-brand-line/45 hover:shadow-md focus-visible:ring-3 focus-visible:ring-link/20"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-tint text-brand-ink transition group-hover:bg-brand group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{handler.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    
                    {handler.level === "PROJECT" ? ctx.project.code : "Organization-wide"}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-ink" />
              </div>

              <p className="mt-3 flex-1 text-xs leading-relaxed text-slate-500">{handler.blurb}</p>

              <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3">
                {submitted ? (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    {submitted.versionLabel} awaits approval · {summariseDiff(parseDiff(submitted.diff))}
                  </p>
                ) : draft ? (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <PencilLine className="h-3.5 w-3.5 shrink-0" />
                    {draft.versionLabel} is a draft · {summariseDiff(parseDiff(draft.diff))}
                  </p>
                ) : null}

                {inForce ? (
                  <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <CircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    In force: {inForce.versionLabel} · {fmtDate(inForce.decidedAt)}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    {total === 0 ? "Never uploaded — running on published defaults" : "No approved version"}
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
