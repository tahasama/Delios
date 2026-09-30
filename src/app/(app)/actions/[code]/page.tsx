import { ActionNotes } from "./lateness";
import { NeededTable, type NeededRow } from "./needed-table";
import { latenessOf } from "@/lib/action-lateness";
import { carrierRefusal } from "@/lib/control-activities";
import { readyReading, countingRevision, meetsRequirement } from "@/lib/readiness";
import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { notFound } from "next/navigation";
import { Card, Chip, Banner } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { confirmReadinessAction } from "@/lib/actions/requirements";
import { clearance } from "@/lib/requirements-process";
import { departmentsOf, DEFAULT_LEAD_DAYS, daysBefore } from "@/lib/schedule";
import { shortfall } from "@/lib/risk-notice";
import { Timeline } from "@/components/timeline";
import { fmtDate } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * One scheduled activity and everything it needs. Departments are tagged by
 * the project manager; the documents come from the approved requirements list.
 */
export default async function ActionDetailPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ dept?: string }> }) {
  const ctx = await requireScope();
  const { db } = ctx;
  const { code } = await params;
  const { dept } = await searchParams;
  // What counts as delivered is the project's answer, and it decides which
  // revision of each document is worth loading at all.
  const reading = await readyReading(ctx);
  const action = await db.action.findFirst({
    where: { code },
    include: {
      entries: { include: { document: { include: { revisions: countingRevision(reading) } } } , orderBy: [{ department: "asc" }, { requiredBy: "asc" }] },
      scheduleActivities: { include: { scheduleVersion: true }, orderBy: { scheduleVersion: { importedAt: "desc" } }, take: 1 },
      confirmations: true,
      notes: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!action) notFound();

  const [disciplines, parties, functions] = await Promise.all([
    db.configValue.findMany({ where: { setKey: "DISCIPLINES", status: "ACTIVE" }, orderBy: { label: "asc" }, select: { code: true, label: true } }),
    db.configValue.findMany({ where: { setKey: "SUPPLIER_CODES" }, select: { code: true, label: true } }),
    db.function.findMany({ select: { code: true, name: true } }),
  ]);
  const deptLabel = (c: string | null) => (c ? disciplines.find((d) => d.code === c)?.label ?? c : "—");
  const partyLabel = (c: string | null) => (c ? parties.find((p) => p.code === c)?.label ?? c : "Us");
  const fnLabel = (c: string | null) => (c ? functions.find((f) => f.code === c)?.name ?? c : "—");

  const depts = departmentsOf(action);
  const control = ctx.can("CONTROL");
  // Only administrators read the audit trail, so only they are sent to it.
  const admin = ctx.can("CONFIGURE");
  const me = await db.projectMembership.findFirst({ where: { projectId: ctx.projectId, userId: ctx.user.id, active: true } });
  const clear = clearance(action);
  // Confirmation opens with the review window: from submit-by to the activity.
  const confirmOpens = action.scheduledDate ? daysBefore(action.scheduledDate, DEFAULT_LEAD_DAYS) : null;
  const entries = dept ? action.entries.filter((e) => e.department === dept) : action.entries;
  // Which of the three moments slipped, for each document, and who writes the
  // note about what was decided.
  const lateness = await latenessOf(ctx, action.id);
  const mayNote = !(await carrierRefusal(ctx, "ACTION_NOTE", { control, standing: true }));
  // Where the time went, and what was decided about work that went ahead
  // without its documents, are not questions worth asking of an action that has
  // neither a slip nor a note.
  const tellsSomething = lateness.rows.some((row) => row.cause || row.outstanding) || action.notes.length > 0;
  const readyCount = action.entries.filter((e) => meetsRequirement(e.document.revisions, e.requiredStatus)).length;
  const overdue = action.scheduledDate && new Date(action.scheduledDate) < new Date();
  // The earliest date a document is owed: where the activity's own clock starts.
  const firstDue = action.entries.map((e) => e.requiredBy).filter(Boolean).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  // The same six states the schedule uses, said the same way here. Done means
  // the documents were there in time; late receipt means they came afterwards.
  const everything = action.entries.length > 0 && readyCount === action.entries.length;
  const afterwards = !!action.lastMetAt && !!action.scheduledDate && action.lastMetAt > action.scheduledDate;
  const readiness = action.entries.length === 0
    ? "UNKNOWN"
    : everything
      ? (overdue ? (afterwards ? "LATE_RECEIPT" : "DONE") : "READY")
      : overdue ? "NOT_READY" : "AT_RISK";
  // Who is short, and the transmittal that tells them — the placeholder numbers
  // are named in it, and the sender adds anyone else who should see it.
  const short = shortfall(action).filter((s) => depts.includes(s.department));
  const deptPeople = await db.projectMembership.findMany({ where: { projectId: ctx.projectId, active: true, department: { in: depts } }, select: { userId: true } });
  const remindHref = `/transmittals/new?${new URLSearchParams({
    reason: "INFORMATION",
    users: deptPeople.map((m) => m.userId).join(","),
    subject: `${action.code} on ${fmtDate(action.scheduledDate)} — ${readiness === "NOT_READY" ? "overdue" : "at risk"}: ${short.map((s) => `${s.department} ${s.missing} of ${s.total} missing`).join(", ")}`,
    message: [
      `${action.name} is planned for ${fmtDate(action.scheduledDate)}.`,
      short.map((s) => `${deptLabel(s.department)} still owes ${s.missing} of ${s.total}: ${s.numbers.join(", ")}.`).join("\n"),
      "Departments concerned: " + depts.map(deptLabel).join(", ") + ".",
      "Send the documents, or say when they will arrive.",
    ].join("\n\n"),
  })}`;

  // The work is taken to have happened once its day has passed — that is what
  // a schedule is — unless Document Control wrote down that it was postponed.
  const postponed = action.notes.find((note) => note.decision === "STOPPED") ?? null;
  const happened = !postponed && !!action.scheduledDate && action.scheduledDate.getTime() < Date.now();

  // One row per required document: what it is, whether it is there, and the
  // step where its time went. Dates are written here so the table stays a
  // client component without carrying Date objects across.
  const delayOf = new Map(lateness.rows.map((row) => [row.docNumber, row]));
  const needed: NeededRow[] = entries.map((e) => {
    const cur = e.document.revisions[0];
    const ready = meetsRequirement(e.document.revisions, e.requiredStatus);
    const slip = delayOf.get(e.document.docNumber) ?? null;
    return {
      id: e.id,
      documentId: e.documentId,
      docNumber: e.document.docNumber,
      title: e.document.title,
      discipline: deptLabel(e.department),
      from: partyLabel(e.submittedBy ?? e.document.originator),
      approvedBy: fnLabel(e.approvedBy),
      requiredStatus: e.requiredStatus,
      submitBy: fmtDate(e.requiredBy),
      submitBySort: e.requiredBy.getTime(),
      submitNote: e.manualDate ? "fixed date" : `${e.leadBusinessDays ?? DEFAULT_LEAD_DAYS} days before`,
      has: cur ? `rev ${cur.value} \u00b7 ${cur.statusCode}` : e.document.isPlaceholder ? "not started" : "not released",
      ready,
      late: !ready && e.requiredBy < new Date(),
      outstanding: !!slip?.outstanding,
      source: slip?.cause?.name ?? null,
      sourceAt: slip?.cause?.at ? fmtDate(slip.cause.at) : null,
      sourceAtSort: slip?.cause?.at ? slip.cause.at.getTime() : null,
      deadline: slip?.cause?.deadline ?? null,
      due: slip?.cause?.due ? fmtDate(slip.cause.due) : null,
      dueSort: slip?.cause?.due ? slip.cause.due.getTime() : null,
      owedBy: slip?.cause?.owedBy ?? slip?.checkpoints.at(-1)?.owedBy ?? null,
      chain: (slip?.checkpoints ?? []).map((point) => ({
        name: point.name,
        deadline: point.deadline,
        at: point.at ? fmtDate(point.at) : null,
        atSort: point.at ? point.at.getTime() : null,
        due: point.due ? fmtDate(point.due) : null,
        late: point.late,
        owedBy: point.owedBy,
      })),
    };
  });

  return (
    <div className="space-y-4">
      {/* The name of the activity, what it is asking of the reader, and the
          narrowing — one sheet, because they are read in that order and then
          answered in the table under them. */}
      <NeededTable
        rows={needed}
        exportHref={`/api/export/baseline?ids=${action.id}`}
        empty={depts.length ? undefined : "Tag the disciplines first."}
        link={control && depts.length ? <Link href="/actions/requirements" className="text-xs font-semibold text-link hover:underline">Requirements &rarr;</Link> : undefined}
        chips={depts.length > 1 ? (
          <>
            <Link href={`/actions/${action.code}`} className={`facet ${!dept ? "font-semibold text-brand-ink" : ""}`}>All</Link>
            {depts.map((d) => (
              <Link key={d} href={`/actions/${action.code}?dept=${d}`} className={`facet ${dept === d ? "font-semibold text-brand-ink" : ""}`}>
                <span className="font-medium">{deptLabel(d)}</span>
                <span className="font-mono tabular-nums">{action.entries.filter((e) => e.department === d).length}</span>
              </Link>
            ))}
          </>
        ) : undefined}
        plate={
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 pt-6 pb-3 sm:px-6">
            <div className="min-w-0">
              <h1 className="plate-name min-w-0">
                <span className="font-mono text-[0.8em] font-medium tracking-tight text-slate-400">{action.code}</span>{" "}
                {action.name}
              </h1>
              <p className="plate-meta mt-1.5">
                {action.ownerName ?? "No owner"} &middot; activity {fmtDate(action.scheduledDate)} &middot; {readyCount} of {action.entries.length} documents ready
                {action.scheduleActivities[0] ? ` \u00b7 schedule ${action.scheduleActivities[0].scheduleVersion.versionLabel}` : ""}
              </p>
              <p className="mt-1 max-w-2xl text-[11.5px] leading-4 text-slate-400">
                Check your documents in the table below, and confirm your discipline&rsquo;s documents are available at the bottom of this page.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link href="/actions" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Schedule</Link>
              <ReadinessChip readiness={readiness} />
            </div>
          </div>
        }
      />

      {/* Who is concerned and what was decided, with the progress beside them. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
        <section id="confirm" className="register register-sheet register-sheet-open">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
            <span className="stencil mr-1 text-slate-400">Disciplines concerned</span>
            {depts.length ? (
              <span className="text-[11px] text-slate-400">
                {clear.cleared
                  ? "every discipline has confirmed its documents are available"
                  : `each confirms its documents are available${confirmOpens ? ` — from ${fmtDate(confirmOpens)}` : ""}`}
              </span>
            ) : null}
            {control ? <Link href="/actions/requirements" className="ml-auto text-[11px] font-semibold text-link hover:underline">Requirements &rarr;</Link> : null}
          </div>
          {depts.length ? (
            <ul className="divide-y divide-line">
              {depts.map((d) => {
                const c = action.confirmations.find((x) => x.department === d);
                const mine = me?.department === d || control;
                // Requirements listed before departments existed count against every one.
                const deptEntries = action.entries.filter((e) => e.department === d || !e.department);
                const missing = deptEntries.filter((e) => !meetsRequirement(e.document.revisions, e.requiredStatus));
                const owes = short.find((one) => one.department === d);
                return (
                  <li key={d} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">
                        {deptLabel(d)}
                        <span className="ml-1.5 text-xs font-normal text-slate-400">· {deptEntries.length - missing.length} of {deptEntries.length} ready</span>
                      </p>
                      {c ? (
                        <p className={`text-[11px] ${c.available ? "text-emerald-700" : "text-red-700"}`}>
                          {c.available ? "Available" : "Not available"} — {c.confirmedByName}, {fmtDate(c.confirmedAt)}{c.note ? ` · ${c.note}` : ""}
                        </p>
                      ) : <p className="text-[11px] text-slate-400">Not confirmed</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {owes && control ? (
                        <Link href={remindHref} className="text-xs font-semibold text-link hover:underline">Notify</Link>
                      ) : null}
                    </div>
                    {mine && (!confirmOpens || confirmOpens.getTime() <= Date.now()) ? (
                      /* Answered the way the sheet asks everything else: plain
                         fields on one line, and one button. */
                      <details className="w-full text-xs">
                        <summary className="cursor-pointer text-xs font-semibold text-link">{c ? "Confirm again" : "Confirm"}</summary>
                        <ActionForm action={confirmReadinessAction} hideSubmit hidden={{ actionId: action.id, department: d }}>
                          <div className="asking mt-2.5 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                            {/* Ticked is available; left untouched says the
                                documents are not there, and then the note is
                                what Document Control is alerted with. */}
                            <label className="flex min-w-0 items-center gap-2 whitespace-nowrap text-xs font-medium text-slate-700">
                              <input type="checkbox" name="available" value="yes" defaultChecked={!missing.length} />
                              Documents available
                            </label>
                            <label className="min-w-0">
                              <span className="sr-only">Note</span>
                              <input name="note" className="plain w-full" placeholder={missing.length ? `${missing.length} not ready — say what and why` : "Note — optional, unless you leave the box unticked"} />
                            </label>
                            <button className="ask">Record</button>
                          </div>
                        </ActionForm>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-5 py-3.5 sm:px-6">
              <Banner tone="warn" title="Needs disciplines">The project manager tags this activity in the disciplines list. Until then its documents cannot be asked for.</Banner>
            </div>
          )}
          {short.length && action.riskNotifiedAt ? (
            <p className="border-t border-line px-5 py-2 text-[11px] text-slate-400 sm:px-6">
              Everyone concerned was warned automatically on {fmtDate(action.riskNotifiedAt)}.
              {admin ? <> <Link href={`/admin/audit?q=${encodeURIComponent(action.code)}`} className="font-semibold text-link underline">Every notice sent &rarr;</Link></> : null}
            </p>
          ) : null}
        </section>

          {tellsSomething ? <ActionNotes notes={action.notes} actionId={action.id} mayNote={mayNote} /> : null}
        </div>

        <aside>
        <Card title="Progress">
          <Timeline
            points={[
              { label: "Disciplines tagged", at: depts.length ? action.createdAt : null, holder: depts.length ? depts.map(deptLabel).join(", ") : "nobody yet" },
              { label: "Documents listed", at: action.entries.length ? action.entries[0].createdAt : null, holder: action.entries.length ? `${action.entries.length} document${action.entries.length === 1 ? "" : "s"}` : "none listed" },
              { label: "First document due", at: firstDue, holder: firstDue && firstDue < new Date() ? "that date has passed" : null },
              ...(action.riskNotifiedAt ? [{ label: "Warned automatically", at: action.riskNotifiedAt, holder: depts.map(deptLabel).join(", ") }] : []),
              { label: "Every document ready", at: everything ? action.lastMetAt ?? action.scheduledDate : null, holder: `${readyCount} of ${action.entries.length} ready` },
              { label: "Disciplines confirmed", at: clear.cleared ? action.confirmations.map((c) => c.confirmedAt).filter(Boolean).sort((x, y) => y!.getTime() - x!.getTime())[0] ?? null : null, holder: `${clear.confirmed.length} of ${clear.depts.length}` },
              // A schedule's date passing is the work happening. Only Document
              // Control saying otherwise — a note that the work was postponed —
              // takes that back.
              {
                label: postponed ? "The work was postponed" : happened ? "The work happened" : "The work happens",
                at: action.scheduledDate,
                holder: postponed ? `${postponed.responsibleName}: ${postponed.reason}` : null,
              },
            ]}
          />
        </Card>
        </aside>
      </div>
    </div>
  );
}

function ReadinessChip({ readiness }: { readiness: "DONE" | "LATE_RECEIPT" | "READY" | "AT_RISK" | "NOT_READY" | "UNKNOWN" }) {
  const map = {
    DONE: ["Done", "bg-emerald-600/10 text-emerald-900 ring-emerald-300"],
    LATE_RECEIPT: ["Late receipt", "bg-violet-100 text-violet-800 ring-violet-300"],
    READY: ["Ready", "bg-emerald-100 text-emerald-800 ring-emerald-200"],
    AT_RISK: ["At risk", "bg-amber-100 text-amber-800 ring-amber-200"],
    NOT_READY: ["Overdue", "bg-red-100 text-red-800 ring-red-200"],
    UNKNOWN: ["No documents listed", "bg-slate-100 text-slate-700 ring-slate-200"],
  } as const;
  return <Chip className={map[readiness][1]}>{map[readiness][0]}</Chip>;
}
