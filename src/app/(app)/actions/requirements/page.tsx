import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { Card, Chip, DataTable, Th, Td, Field, inputCls, btn } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { issueCallsAction, remindCallAction, closeCallAction, issueToSendersAction } from "@/lib/actions/requirements";
import { departmentRows, senderRows, clearance, isDepartmentSender, type CallState } from "@/lib/requirements-process";
import { businessDaysAfter, departmentsOf } from "@/lib/schedule";
import { fmtDate } from "@/lib/utils";
import { ArrowLeft, Download, Upload } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Document requirements" };

const CALL_CHIP: Record<CallState, [string, string]> = {
  NOT_ISSUED: ["Not asked yet", "bg-slate-100 text-slate-600 ring-slate-200"],
  OPEN: ["Waiting", "bg-amber-100 text-amber-800 ring-amber-200"],
  OVERDUE: ["Overdue", "bg-red-100 text-red-800 ring-red-200"],
  ANSWERED: ["Answered", "bg-emerald-100 text-emerald-800 ring-emerald-200"],
};

/**
 * The whole road from schedule to a safe activity, on one page, in order:
 * departments per activity → ask the departments → issue to senders →
 * confirm before the activity.
 */
export default async function RequirementsPage() {
  const ctx = await requireScope();
  const { db, user } = ctx;
  const control = ctx.can("CONTROL");
  const plan = ctx.can("PLAN") || control;

  const [actions, depts, senders, disciplines, parties, pendingSets, me] = await Promise.all([
    db.action.findMany({ orderBy: [{ scheduledDate: "asc" }, { code: "asc" }], include: { confirmations: true } }),
    departmentRows(ctx),
    senderRows(ctx),
    db.configValue.findMany({ where: { setKey: "DISCIPLINES" }, select: { code: true, label: true } }),
    db.party.findMany({ select: { code: true, name: true } }),
    db.controlledSet.findMany({
      where: { projectId: ctx.projectId, kind: { in: ["ACTION_DEPARTMENTS", "DOCUMENT_REQUIREMENTS"] } },
      include: { versions: { where: { state: { in: ["DRAFT", "SUBMITTED", "APPROVED"] } }, orderBy: { createdAt: "desc" } } },
    }),
    db.projectMembership.findFirst({ where: { projectId: ctx.projectId, userId: user.id, active: true } }),
  ]);
  const deptName = (c: string) => disciplines.find((d) => d.code === c)?.label ?? c;
  const senderName = (s: string) => (isDepartmentSender(s) ? `${deptName(s.slice(5))} (us)` : parties.find((p) => p.code === s)?.name ?? s);
  const setState = (kind: string) => {
    const versions = pendingSets.find((s) => s.kind === kind)?.versions ?? [];
    return { pending: versions.find((v) => v.state !== "APPROVED") ?? null, inForce: versions.find((v) => v.state === "APPROVED") ?? null };
  };
  const tagging = setState("ACTION_DEPARTMENTS");
  const list = setState("DOCUMENT_REQUIREMENTS");
  const myDept = me?.department ?? null;

  const tagged = actions.filter((a) => departmentsOf(a).length).length;
  const toAsk = depts.filter((d) => d.notIssued.length);
  const due = businessDaysAfter(new Date(), 5).toISOString().slice(0, 10);
  const horizon = businessDaysAfter(new Date(), 10).getTime();
  const upcoming = actions.filter((a) => a.scheduledDate && a.scheduledDate.getTime() <= horizon && departmentsOf(a).length && !clearance(a).cleared);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Document requirements</h1>
          <p className="mt-1 text-sm text-slate-500">
            Four steps, in order: tag each activity with the departments it concerns, ask those departments what documents
            they need, tell whoever delivers them, and confirm before the work happens. Each step says the ways it can be done.
          </p>
        </div>
        <Link href="/actions" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Schedule</Link>
      </div>

      {/* 1 — the project manager's list */}
      <Card
        title="1 · Departments per activity"
        description={`${tagged} of ${actions.length} activities tagged · the project manager fills this list, uploads and approves it`}
        actions={
          <div className="flex gap-2">
            <a href="/api/controlled/current/ACTION_DEPARTMENTS" className={btn("secondary", "sm")}><Download className="h-4 w-4" /> Download list</a>
            {plan ? <Link href="/settings/controlled/ACTION_DEPARTMENTS" className={btn(tagged < actions.length ? "primary" : "secondary", "sm")}><Upload className="h-4 w-4" /> Upload</Link> : null}
          </div>
        }
      >
        <p className="mb-2 text-[11px] leading-5 text-slate-500">
          <strong className="font-semibold text-slate-600">Two ways.</strong> Download the list, tag every activity in the
          spreadsheet and upload it back — one pass for the whole schedule, and it goes through approval. Or tag one activity on
          its own page, which is right for a single correction.
        </p>
        <p className="text-xs text-slate-500">
          {tagging.pending
            ? <span className="font-semibold text-amber-700">{tagging.pending.versionLabel} is {tagging.pending.state === "DRAFT" ? "uploaded, not yet submitted" : "waiting for approval"}.</span>
            : tagged < actions.length
              ? <span className="font-semibold text-amber-700">{actions.length - tagged} activit{actions.length - tagged === 1 ? "y has" : "ies have"} no department — nobody can be asked about {actions.length - tagged === 1 ? "it" : "them"}.</span>
              : `Every activity is tagged${tagging.inForce ? ` (${tagging.inForce.versionLabel}, ${fmtDate(tagging.inForce.decidedAt)})` : ""}.`}
        </p>
      </Card>

      {/* 2 — ask each department, chase, collect */}
      <Card
        title="2 · Ask the departments"
        description="Each department fills its sheet — documents needed, from whom, by when (5 working days before the activity unless it says otherwise)"
        actions={control ? <Link href="/settings/controlled/DOCUMENT_REQUIREMENTS" className={btn("secondary", "sm")}><Upload className="h-4 w-4" /> Upload filled list</Link> : undefined}
      >
        <p className="mb-2 text-[11px] leading-5 text-slate-500">
          <strong className="font-semibold text-slate-600">Two ways.</strong> Ask the departments here: each is issued its own
          sheet with a date to answer by, and the ask, the date and the answer are all recorded. Or, where a department sent its
          list some other way, upload the filled list yourself — quicker, but the ask leaves no trace and nothing chases it.
        </p>
        {list.pending ? <p className="mb-3 text-xs font-semibold text-amber-700">Requirements {list.pending.versionLabel} is {list.pending.state === "DRAFT" ? "uploaded, not yet submitted" : "waiting for approval"}.</p> : null}

        {control && toAsk.length ? (
          <div className="mb-4 rounded-xl border border-brand-line/20 bg-tint-soft p-3">
            <ActionForm action={issueCallsAction} submitLabel="Issue to departments" size="sm">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-slate-600">To ask</p>
                  <div className="flex flex-wrap gap-2">
                    {toAsk.map((d) => (
                      <label key={d.department} className="flex items-center gap-1.5 rounded-lg bg-surface px-2 py-1 text-xs ring-1 ring-slate-200">
                        <input type="checkbox" name="department" value={d.department} defaultChecked /> {deptName(d.department)} <span className="text-slate-400">· {d.notIssued.length} new</span>
                      </label>
                    ))}
                  </div>
                </div>
                <Field label="Answer by" required><input type="date" name="dueAt" defaultValue={due} required className={inputCls} /></Field>
              </div>
            </ActionForm>
          </div>
        ) : null}

        {depts.length ? (
          <DataTable head={<tr><Th>Department</Th><Th>Activities</Th><Th>Documents listed</Th><Th>Call</Th><Th /></tr>}>
            {depts.map((d) => (
              <tr key={d.department} className={myDept === d.department ? "bg-tint-soft" : undefined}>
                <Td>
                  <span className="text-sm font-semibold text-slate-800">{deptName(d.department)}</span>
                  {myDept === d.department ? <span className="ml-1.5 text-[10px] font-semibold text-link">your department</span> : null}
                  <span className={`block text-[11px] ${d.members ? "text-slate-400" : "font-semibold text-red-700"}`}>{d.members ? `${d.members} ${d.members === 1 ? "person" : "people"}` : "nobody assigned"}</span>
                </Td>
                <Td className="text-xs">{d.actions.map((a) => a.code).join(", ")}{d.notIssued.length && d.call ? <span className="block text-[11px] text-amber-700">{d.notIssued.length} not asked yet</span> : null}</Td>
                <Td className="text-xs tabular-nums">{d.requirements}</Td>
                <Td className="text-xs">
                  <Chip className={CALL_CHIP[d.state][1]}>{CALL_CHIP[d.state][0]}</Chip>
                  {d.call ? (
                    <span className="mt-1 block text-[11px] text-slate-500">
                      {d.call.answeredAt ? `${fmtDate(d.call.answeredAt)} · ${d.call.answerNote}` : `due ${fmtDate(d.call.dueAt)}`}
                      {!d.call.answeredAt && d.call.reminders ? ` · reminded ${d.call.reminders}×` : ""}
                    </span>
                  ) : null}
                </Td>
                <Td>
                  <div className="flex flex-wrap items-start justify-end gap-2">
                    <a href={`/api/requirements/sheet?dept=${d.department}`} className={btn("ghost", "sm")}><Download className="h-4 w-4" /> Sheet</a>
                    {control && d.call && !d.call.answeredAt ? (
                      <>
                        <ActionForm action={remindCallAction} submitLabel={d.state === "OVERDUE" ? "Chase" : "Remind"} variant={d.state === "OVERDUE" ? "danger" : "secondary"} size="sm" hidden={{ callId: d.call.id }} className="space-y-0" />
                        <details className="text-xs">
                          <summary className={`${btn("ghost", "sm")} cursor-pointer list-none`}>Nothing needed</summary>
                          <div className="mt-2 w-64">
                            <ActionForm action={closeCallAction} submitLabel="Record answer" size="sm" hidden={{ callId: d.call.id }}>
                              <input name="note" required className={inputCls} placeholder="What the department answered" defaultValue="Nothing needed for these activities" />
                            </ActionForm>
                          </div>
                        </details>
                      </>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <p className="text-xs text-slate-400">No department is tagged yet — step 1 first.</p>
        )}
      </Card>

      {/* 3 — issue the approved list to whoever sends the documents */}
      <Card title="3 · Tell each sender what to deliver" description="A sender is whoever submits the document: the contractor, the supplier, or our own department for documents we write. Each gets the list the departments returned in step 2, with the submit-by dates to plan on. Reviewers have the working days between submit-by and the activity.">
        <p className="mb-2 text-[11px] leading-5 text-slate-500">
          <strong className="font-semibold text-slate-600">Two ways.</strong> Issue the list here, which records what each sender
          was told and when, and warns you when the list has changed since. Or download a sender’s list and send it yourself,
          on a transmittal — use that when it has to travel with other paperwork.
        </p>
        {senders.length ? (
          <>
            <DataTable head={<tr><Th>Sender</Th><Th>Documents</Th><Th>First submit-by</Th><Th>Issued</Th><Th /></tr>}>
              {senders.map((s) => (
                <tr key={s.sender}>
                  <Td><span className="text-sm font-semibold text-slate-800">{senderName(s.sender)}</span>{!s.recipients ? <span className="block text-[11px] font-semibold text-red-700">nobody to notify</span> : null}</Td>
                  <Td className="text-xs tabular-nums">{s.documents}</Td>
                  <Td className="whitespace-nowrap text-xs">{fmtDate(s.firstNeeded)}</Td>
                  <Td className="text-xs">
                    {s.lastIssue ? <>{fmtDate(s.lastIssue.issuedAt)} · {s.lastIssue.issuedByName}</> : <span className="font-semibold text-amber-700">not issued</span>}
                    {s.lastIssue && s.changedSinceIssue ? <span className="block text-[11px] font-semibold text-amber-700">{s.changedSinceIssue} changed since — issue again</span> : null}
                  </Td>
                  <Td className="text-right"><a href={`/api/requirements/sheet?sender=${encodeURIComponent(s.sender)}`} className={btn("ghost", "sm")}><Download className="h-4 w-4" /> List</a></Td>
                </tr>
              ))}
            </DataTable>
            {control && senders.some((s) => !s.lastIssue || s.changedSinceIssue) ? (
              <div className="mt-3 rounded-xl border border-brand-line/20 bg-tint-soft p-3">
                <ActionForm action={issueToSendersAction} submitLabel="Issue" size="sm">
                  <div className="flex flex-wrap gap-2">
                    {senders.filter((s) => !s.lastIssue || s.changedSinceIssue).map((s) => (
                      <label key={s.sender} className="flex items-center gap-1.5 rounded-lg bg-surface px-2 py-1 text-xs ring-1 ring-slate-200">
                        <input type="checkbox" name="sender" value={s.sender} defaultChecked /> {senderName(s.sender)}
                      </label>
                    ))}
                  </div>
                </ActionForm>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-slate-400">Nothing to issue until a requirements list is approved.</p>
        )}
      </Card>

      {/* 4 — before the activity */}
      <Card title="4 · Confirm before the activity" description="Each concerned department confirms its documents are available, on the activity itself. The activity is cleared when all of them have. One way only: a department confirms for itself, and nobody confirms on its behalf — that is the whole value of the step.">
        {upcoming.length ? (
          <DataTable head={<tr><Th>Activity</Th><Th>Date</Th><Th>Departments</Th></tr>}>
            {upcoming.map((a) => {
              const c = clearance(a);
              return (
                <tr key={a.id}>
                  <Td><Link href={`/actions/${a.code}#confirm`} className="font-mono text-xs font-bold text-link hover:underline">{a.code}</Link><span className="block max-w-72 truncate text-xs text-slate-500">{a.name}</span></Td>
                  <Td className={`whitespace-nowrap text-xs ${a.scheduledDate && a.scheduledDate.getTime() < Date.now() ? "font-semibold text-red-700" : ""}`}>{fmtDate(a.scheduledDate)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {c.depts.map((d) => (
                        <Chip key={d} className={c.confirmed.includes(d) ? "bg-emerald-100 text-emerald-800 ring-emerald-200" : c.short.includes(d) ? "bg-red-100 text-red-800 ring-red-200" : "bg-slate-100 text-slate-600 ring-slate-200"}>
                          {d} {c.confirmed.includes(d) ? "✓" : c.short.includes(d) ? "short" : "…"}
                        </Chip>
                      ))}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        ) : (
          <p className="text-xs text-slate-400">No activity in the next two weeks waiting for confirmation.</p>
        )}
      </Card>
    </div>
  );
}
