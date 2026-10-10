import { ActionNotes } from "./lateness";
import { NeededTable, type NeededRow } from "./needed-table";
import { latenessOf } from "@/lib/action-lateness";
import { carrierRefusal, actIsOff } from "@/lib/control-activities";
import { meetsRequirement } from "@/lib/readiness";
import Link from "next/link";
import { formPolicy } from "@/lib/field-policy";
import { requireScope } from "@/lib/scope";
import { notFound } from "next/navigation";
import { Card, Banner } from "@/components/ui";
import { StateStamp } from "../state-stamp";
import { ActionForm } from "@/components/form";
import { confirmReadinessAction } from "@/lib/actions/requirements";
import { clearance } from "@/lib/requirements-process";
import { departmentsOf, DEFAULT_LEAD_DAYS, daysBefore } from "@/lib/schedule";
import { shortfall } from "@/lib/risk-notice";
import { Timeline } from "@/components/timeline";
import { fmtDate } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import { getActiveSet } from "@/lib/config";
import { api } from "@/lib/api/client";
import { holders } from "@/lib/api/settings";
import { legacyActionByCode, scheduleSource } from "@/lib/api/schedule";
import { actionState, stateLabel, dayHasPassed, DEFAULT_RISK_DAYS } from "@/lib/action-state";

export const dynamic = "force-dynamic";

/**
 * One scheduled activity and everything it needs. Departments are tagged by
 * the project manager; the documents come from the approved requirements list.
 */
export default async function ActionDetailPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ dept?: string }> }) {
  const ctx = await requireScope();
  const readinessPolicy = await formPolicy(ctx, "ACTION");
  const { code } = await params;
  const { dept } = await searchParams;
  const action = await legacyActionByCode(ctx, code);
  if (!action) notFound();

  const [disciplines, parties, functions] = await Promise.all([
    getActiveSet("DISCIPLINES").then((rows) => [...rows].sort((a, b) => a.label.localeCompare(b.label))),
    // Suppliers are the organizations the project deals with.
    api<{ code: string; name: string }[]>("/api/parties").then((rows) => rows.map((one) => ({ code: one.code, label: one.name }))).catch(() => []),
    // Who approves a document is not on a need in the backend: no function is named.
    Promise.resolve([] as { code: string; name: string }[]),
  ]);
  const deptLabel = (c: string | null) => (c ? disciplines.find((d) => d.code === c)?.label ?? c : "—");
  const partyLabel = (c: string | null) => (c ? parties.find((p) => p.code === c)?.label ?? c : "Us");
  const fnLabel = (c: string | null) => (c ? functions.find((f) => f.code === c)?.name ?? c : "—");

  const depts = departmentsOf(action);
  const control = ctx.can("CONTROL");
  // Only administrators read the audit trail, so only they are sent to it.
  const admin = ctx.can("CONFIGURE");
  const me = { department: ctx.user.department ?? null };
  const clear = clearance(action);
  // Confirmation opens with the review window: from submit-by to the activity.
  const confirmOpens = action.scheduledDate ? daysBefore(action.scheduledDate, DEFAULT_LEAD_DAYS) : null;
  const entries = dept ? action.entries.filter((e) => e.department === dept) : action.entries;
  // Which of the three moments slipped, for each document, and who writes the
  // note about what was decided.
  const lateness = await latenessOf(ctx, action.id);
  // Left out by the organization: the notes already written are still read.
  const mayNote = !(await actIsOff(ctx, "ACTION_NOTE")) && !(await carrierRefusal(ctx, "ACTION_NOTE", { control, standing: true }));
  // Where the time went, and what was decided about work that went ahead
  // without its documents, are not questions worth asking of an action that has
  // neither a slip nor a note.
  const tellsSomething = lateness.rows.some((row) => row.cause || row.outstanding) || action.notes.length > 0;
  const readyCount = action.entries.filter((e) => meetsRequirement(e.document.revisions, e.requiredStatus)).length;
  // The earliest date a document is owed: where the activity's own clock starts.
  const firstDue = action.entries.map((e) => e.requiredBy).filter(Boolean).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  // The same states the schedule uses, by the same rule, so the two pages never
  // disagree about one action.
  const everything = action.entries.length > 0 && readyCount === action.entries.length;
  const riskDays = (await scheduleSource(ctx)).source?.riskWindowDays ?? DEFAULT_RISK_DAYS;
  const readiness = actionState(action, riskDays);
  // Who is short, and the transmittal that tells them — the placeholder numbers
  // are named in it, and the sender adds anyone else who should see it. Each
  // discipline is told about its own documents only: Notify on its row reaches
  // its people, not every discipline the action concerns.
  const short = shortfall(action).filter((s) => depts.includes(s.department));
  // A department is a discipline: the people whose membership names one of them.
  const people = await holders(ctx.projectId, "READ").catch(() => []);
  const remindHref = (department: string) => {
    const owes = short.find((one) => one.department === department)!;
    return `/transmittals/new?${new URLSearchParams({
      reason: "INFORMATION",
      users: people.filter((one) => one.department === department).map((one) => one.id).join(","),
      subject: `${action.code} on ${fmtDate(action.scheduledDate)} — ${stateLabel(readiness).toLowerCase()}: ${deptLabel(department)} ${owes.missing} of ${owes.total} missing`,
      message: [
        `${action.name} is planned for ${fmtDate(action.scheduledDate)}.`,
        `${deptLabel(department)} still owes ${owes.missing} of ${owes.total}: ${owes.numbers.join(", ")}.`,
        "Send the documents, or say when they will arrive.",
      ].join("\n\n"),
    })}`;
  };

  // The work is taken to have happened once its day has passed — that is what
  // a schedule is — unless Document Control wrote down that it was postponed.
  const postponed = action.notes.find((note) => note.decision === "STOPPED") ?? null;
  const happened = !postponed && dayHasPassed(action);

  // One row per required document: what it is, whether it is there, and the
  // step where its time went. Dates are written here so the table stays a
  // client component without carrying Date objects across.
  const delayOf = new Map(lateness.rows.map((row) => [row.docNumber, row]));
  // Where each needed document stands, in the organization's own words for its states: it is listed whatever its
  // state, so people know it exists even before it is ready.
  const { policy } = await import("@/lib/control-activities");
  const { stateNames, stateName } = await import("@/lib/state-names");
  const [names, together] = await Promise.all([stateNames(ctx), policy(ctx, "POLICY_RELEASE").then((one) => one === "TOGETHER")]);
  const standing = (e: (typeof entries)[number]) => {
    const latest = e.document.latest;
    if (!latest) return e.document.isPlaceholder ? "placeholder · not started" : "no revision yet";
    const name = stateName(names, latest.state, { together, held: latest.held });
    return `rev ${latest.value}${latest.statusCode ? ` · ${latest.statusCode}` : ""} · ${name.toLowerCase()}`;
  };
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
      has: e.document.latest !== undefined ? standing(e) : cur ? `rev ${cur.value} \u00b7 ${cur.statusCode}` : e.document.isPlaceholder ? "not started" : "not released",
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
          /* The action as one filled-in docket: the name leads, in ink, its
             stamp beside it; the facts sit in boxed fields underneath. */
          <div className="docket-head px-5 pt-5 pb-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="min-w-0 flex-1">
                <Link href="/actions" className="stencil inline-flex items-center gap-1 hover:text-brand-ink"><ArrowLeft className="h-3.5 w-3.5" /> Schedule &amp; actions</Link>
                <h1 className="plate-name mt-2 min-w-0">{action.name}</h1>
              </div>
              <div className="pt-6"><StateStamp state={readiness} size="lg" /></div>
            </div>
            <div className="fields mt-4 grid-cols-2 sm:grid-cols-4">
              <div className="field">
                <span className="field-label">Action No.</span>
                <span className="field-value font-mono">{action.code}</span>
                <span className="field-note">{action.scheduleRef && action.scheduleRef !== action.code ? `planner’s ID ${action.scheduleRef}` : "our number"}</span>
              </div>
              <div className="field">
                <span className="field-label">Day of the work</span>
                <span className="field-value">{fmtDate(action.scheduledDate)}</span>
                <span className="field-note">{action.scheduleActivities[0] ? `schedule ${action.scheduleActivities[0].scheduleVersion.versionLabel}` : "from the schedule"}</span>
              </div>
              <div className="field" data-tone={readyCount < action.entries.length ? "needs" : undefined}>
                <span className="field-label">Documents ready</span>
                <span className="field-value">{readyCount}<small>of {action.entries.length}</small></span>
                <span className="field-note">checked in the table below</span>
              </div>
              <a href="#confirm" className="field" data-tone={depts.length && !clear.cleared ? "needs" : undefined}>
                <span className="field-label">Disciplines confirmed</span>
                <span className="field-value">{clear.confirmed.length}<small>of {clear.depts.length}</small></span>
                <span className="field-note">confirm yours at the bottom of the page</span>
              </a>
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
                        <p className={`signature mt-1 text-[11.5px] ${c.available ? "" : "text-red-700"}`}>
                          {c.available ? "Available" : "Not available"} — {c.confirmedByName}, {fmtDate(c.confirmedAt)}{c.note ? ` · ${c.note}` : ""}
                        </p>
                      ) : <p className="text-[11px] text-slate-400">Not confirmed</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {owes && control ? (
                        <Link href={remindHref(d)} className="text-xs font-semibold text-link hover:underline">Notify {deptLabel(d)}</Link>
                      ) : null}
                    </div>
                    {mine && (!confirmOpens || confirmOpens.getTime() <= Date.now()) ? (
                      /* Answered the way the sheet asks everything else: plain
                         fields on one line, and one button. Available or not is
                         a choice somebody makes, never what an untouched box
                         happens to say. */
                      <details className="group w-full text-xs">
                        <summary className="ask cursor-pointer list-none [&::-webkit-details-marker]:hidden">{c ? "Confirm again" : "Confirm"}</summary>
                        <ActionForm action={confirmReadinessAction} hideSubmit hidden={{ actionId: action.id, department: d }}>
                          <fieldset className="asking mt-2.5 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                            <legend className="sr-only">Are {deptLabel(d)}&rsquo;s documents available?</legend>
                            <div className="flex items-center gap-4 whitespace-nowrap text-xs font-medium text-slate-700">
                              <label className="flex items-center gap-1.5">
                                <input type="radio" name="available" value="yes" required />
                                Available
                              </label>
                              <label className="flex items-center gap-1.5">
                                <input type="radio" name="available" value="no" required />
                                Not available
                              </label>
                            </div>
                            <label className="min-w-0">
                              <span className="sr-only">Note</span>
                              <input name="note" required={missing.length > 0 || readinessPolicy.rules.note === "REQUIRED"} className="plain w-full" placeholder={missing.length ? `${missing.length} not ready — say why it goes ahead, or what is missing` : readinessPolicy.rules.note === "REQUIRED" ? `${readinessPolicy.labels.note} — this project asks for one every time` : "Note — needed when not available"} />
                            </label>
                            <button className="ask" data-on="true">Record</button>
                          </fieldset>
                        </ActionForm>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-5 py-3.5 sm:px-6">
              <Banner tone="warn" title="Needs disciplines">The disciplines-per-action list does not tag this action yet. Document Control, or whoever plans the project, uploads it; until then its documents cannot be asked for.</Banner>
            </div>
          )}
          {short.length && action.riskNotifiedAt ? (
            <p className="border-t border-line px-5 py-2 text-[11px] text-slate-400 sm:px-6">
              Everyone concerned was warned automatically on {fmtDate(action.riskNotifiedAt)}.
              {admin ? <> <Link href={`/settings/audit?q=${encodeURIComponent(action.code)}`} className="font-semibold text-link underline">Every notice sent &rarr;</Link></> : null}
            </p>
          ) : null}
        </section>

          {tellsSomething ? <ActionNotes notes={action.notes} actionId={action.id} mayNote={mayNote} /> : null}
        </div>

        <aside>
        <Card title="Progress">
          <Timeline
            points={[
              { label: "Disciplines tagged", done: depts.length > 0, at: depts.length ? action.createdAt ?? null : null, holder: depts.length ? depts.map(deptLabel).join(", ") : "nobody yet" },
              { label: "Documents listed", done: action.entries.length > 0, at: action.entries.length ? action.entries[0].createdAt ?? null : null, holder: action.entries.length ? `${action.entries.length} document${action.entries.length === 1 ? "" : "s"}` : "none listed" },
              { label: "First document due", at: firstDue, planned: !!firstDue && firstDue > new Date(), holder: firstDue && firstDue < new Date() ? "that date has passed" : null },
              ...(action.riskNotifiedAt ? [{ label: "Warned automatically", at: action.riskNotifiedAt, holder: depts.map(deptLabel).join(", ") }] : []),
              { label: "Every document ready", at: everything ? action.lastMetAt ?? action.scheduledDate : null, holder: `${readyCount} of ${action.entries.length} ready` },
              { label: "Disciplines confirmed", at: clear.cleared ? action.confirmations.map((c) => c.confirmedAt).filter(Boolean).sort((x, y) => y!.getTime() - x!.getTime())[0] ?? null : null, holder: `${clear.confirmed.length} of ${clear.depts.length}` },
              // A schedule's date passing is the work happening. Only Document
              // Control saying otherwise — a note that the work was postponed —
              // takes that back.
              {
                label: postponed ? "The work was postponed" : happened ? "The work happened" : "The work happens",
                at: action.scheduledDate,
                planned: !happened && !postponed,
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
