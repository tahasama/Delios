import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { notFound } from "next/navigation";
import { Chip, DataTable, Th, Td } from "@/components/ui";
import { parseSnapshotPayload } from "@/lib/history";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { ArrowLeft, CalendarClock, Download, FileClock, Files, GitBranch, Send } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SnapshotDetailPage({ params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  const { db } = await requireScope();
  const { id, snapshotId } = await params;
  const snapshot = await db.documentSnapshot.findFirst({ where: { id: snapshotId, documentId: id } });
  if (!snapshot) notFound();
  const payload = parseSnapshotPayload(snapshot.payload);
  const document = payload.document;
  const selectedRevision = snapshot.revisionId ? document.revisions.find((revision) => revision.id === snapshot.revisionId) : document.revisions.at(-1);
  const allTransmittals = document.revisions.flatMap((revision) => revision.transmittalItems.map((item) => ({ ...item, revision: revision.value })));

  return (
    <div className="space-y-7">
      <section className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-5">
        <div className="flex items-start justify-between gap-5">
          <div className="flex items-start gap-4"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface text-amber-700 shadow-sm"><FileClock className="h-5 w-5" /></span><div><p className="text-xs font-bold uppercase tracking-[0.13em] text-amber-800">Recorded point in time</p><h1 className="mt-1.5 text-xl font-semibold text-slate-950">{document.docNumber} · {eventLabel(snapshot.eventType)}</h1><p className="mt-1 text-sm text-slate-600">Captured {fmtDateTime(snapshot.capturedAt)} by {snapshot.actorName}. Values below are historical and cannot be edited.</p>{snapshot.eventLabel ? <p className="mt-2 text-xs leading-5 text-amber-900/75">{snapshot.eventLabel}</p> : null}</div></div>
          <div className="flex items-center gap-2"><Link href={`/documents/${id}/history`} className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-surface px-3 py-2 text-xs font-semibold text-slate-700"><ArrowLeft className="h-3.5 w-3.5" /> History</Link><Link href={`/documents/${id}`} className="rounded-xl bg-brand-strong px-3 py-2 text-xs font-semibold text-white">Current document</Link></div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel title="Document identity at this point" description="The metadata that governed this document at the recorded event.">
          <dl className="grid grid-cols-3 gap-x-6 gap-y-5">
            <Value label="Document number" value={document.docNumber} mono />
            <Value label="Document state" value={human(document.state)} />
            <Value label="Record type" value={human(document.kind)} />
            <Value label="Title" value={document.title} wide />
            <Value label="Deliverable type" value={document.deliverableType} />
            <Value label="Document type" value={document.docType} />
            <Value label="Discipline" value={document.discipline} />
            <Value label="Originator" value={document.originator} />
            <Value label="Sub-project" value={document.subProject} />
            <Value label="Contract / PO" value={document.contractRef} />
            <Value label="Criticality" value={document.criticality} />
            <Value label="Confidentiality" value={document.confidentiality} />
            <Value label="Retention class" value={document.retentionClass} />
            <Value label="Placeholder" value={document.isPlaceholder ? "Yes" : "No"} />
            <Value label="Received" value={fmtDate(document.receivedDate)} />
          </dl>
        </Panel>

        <Panel title="Focus revision" description="The revision directly associated with this event, when applicable.">
          {selectedRevision ? <div className="space-y-5"><div className="flex items-center justify-between"><div><p className="font-mono text-2xl font-semibold text-slate-900">Rev {selectedRevision.value}</p><p className="mt-1 text-xs text-slate-400">{human(selectedRevision.series)} series</p></div><RevisionState state={selectedRevision.state} /></div><dl className="grid grid-cols-2 gap-4"><Value label="Status" value={selectedRevision.statusCode} /><Value label="Phase" value={selectedRevision.phase} /><Value label="Reason" value={selectedRevision.reasonForRevision} wide /><Value label="Change" value={selectedRevision.changeDescription} wide /><Value label="Released" value={fmtDate(selectedRevision.releasedAt)} /><Value label="Released by" value={selectedRevision.releasedByName} /></dl><div className="grid grid-cols-4 gap-2"><Count label="Files" value={selectedRevision.files.length} /><Count label="Approvals" value={selectedRevision.approvals.length} /><Count label="Reviews" value={selectedRevision.cycles.length} /><Count label="Issues" value={selectedRevision.transmittalItems.length} /></div></div> : <p className="text-sm text-slate-400">No revision had been established at this point.</p>}
        </Panel>
      </section>

      <Panel title="Revision history at this point" description="Only evidence that existed when the snapshot was captured is shown.">
        {document.revisions.length ? <DataTable id="snapshot-revisions" className="shadow-none" head={<tr><Th>Revision</Th><Th>State</Th><Th>Status</Th><Th>Change</Th><Th>Files</Th><Th>Review</Th><Th>Approval</Th><Th>Released</Th></tr>}>{document.revisions.map((revision) => <tr key={revision.id}><Td><span className="font-mono font-semibold">{revision.value}</span><span className="ml-2 text-[11px] text-slate-400">{human(revision.series)}</span></Td><Td><RevisionState state={revision.state} /></Td><Td>{revision.statusCode ?? "—"}</Td><Td><p className="max-w-sm text-xs text-slate-600">{revision.changeDescription ?? revision.reasonForRevision ?? "—"}</p></Td><Td>{revision.files.length}</Td><Td>{revision.cycles.length ? `${revision.cycles.length} cycle${revision.cycles.length === 1 ? "" : "s"}` : "—"}</Td><Td>{revision.approvals.length ? revision.approvals.map((approval) => approval.approverName).join(", ") : "—"}</Td><Td>{fmtDate(revision.releasedAt)}</Td></tr>)}</DataTable> : <p className="text-sm text-slate-400">No revisions existed at this point.</p>}
      </Panel>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Review and workflow evidence" description="Assignments, outcomes, comments and approvals recorded by this point.">
          {selectedRevision && (selectedRevision.cycles.length || selectedRevision.approvals.length || selectedRevision.workflowRuns.length) ? <div className="space-y-4">{selectedRevision.approvals.map((approval) => <div key={approval.id} className="rounded-xl bg-emerald-50 px-4 py-3"><p className="text-xs font-semibold text-emerald-900">Approved by {approval.approverName}</p><p className="mt-1 text-[11px] text-emerald-800/70">{approval.approverRole} · matrix v{approval.matrixVersion} · {fmtDateTime(approval.decidedAt)}{approval.withdrawnAt ? " · later withdrawn" : ""}</p></div>)}{selectedRevision.cycles.map((cycle) => <div key={cycle.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-slate-800">Review cycle {cycle.sequence}</p><Chip>{human(cycle.status)}</Chip></div><p className="mt-1 text-xs text-slate-500">{human(cycle.mode)} · outcome {cycle.outcome ? human(cycle.outcome) : "not recorded"}</p><p className="mt-2 text-[11px] text-slate-400">Reviewers: {cycle.assignments.map((assignment) => assignment.userName).join(", ") || "none"} · {cycle.comments.length} comment{cycle.comments.length === 1 ? "" : "s"}</p>{cycle.comments.length ? <ul className="mt-3 space-y-2">{cycle.comments.map((comment) => <li key={comment.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><span className="font-semibold">{comment.classification}</span> · {comment.text}{comment.progressionPreventing ? <span className="ml-1 text-red-600">blocking</span> : null}</li>)}</ul> : null}</div>)}</div> : <p className="text-sm text-slate-400">No review, workflow or approval evidence had been recorded for the focus revision.</p>}
        </Panel>

        <Panel title="Files and integrity" description="The exact file records and hashes attached by this point.">
          {selectedRevision?.files.length ? <ul className="divide-y divide-slate-100">{selectedRevision.files.map((file) => <li key={file.id} className="flex items-center justify-between gap-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{file.name}</p><p className="mt-1 truncate font-mono text-[10px] text-slate-400">SHA-256 {file.sha256}</p><p className="mt-1 text-[11px] text-slate-400">{human(file.kind)} · {file.uploadedByName ?? "system"} · {fmtDateTime(file.createdAt)}</p></div><a href={`/api/files/${file.id}`} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-link"><Download className="h-3.5 w-3.5" /> Open</a></li>)}</ul> : <p className="text-sm text-slate-400">No files were attached to the focus revision at this point.</p>}
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Schedule context" description="Actions that required this document and their dates at this point.">
          {document.baselineEntries.length ? <ul className="divide-y divide-slate-100">{document.baselineEntries.map((entry) => <li key={entry.id} className="flex items-center justify-between gap-4 py-3"><div className="flex items-start gap-3"><CalendarClock className="mt-0.5 h-4 w-4 text-link" /><div><p className="text-sm font-semibold text-slate-800">{entry.action.code} · {entry.action.name}</p><p className="mt-1 text-xs text-slate-500">Needed at {entry.requiredStatus} by {fmtDate(entry.requiredBy)}</p></div></div><span className="text-xs text-slate-400">action {fmtDate(entry.action.scheduledDate)}</span></li>)}</ul> : <p className="text-sm text-slate-400">The document was not linked to a scheduled action at this point.</p>}
        </Panel>

        <Panel title="Distribution context" description="Transmittals and recipient evidence that existed at this point.">
          {allTransmittals.length ? <ul className="divide-y divide-slate-100">{allTransmittals.map((item) => <li key={item.id} className="flex items-start justify-between gap-4 py-3"><div className="flex items-start gap-3"><Send className="mt-0.5 h-4 w-4 text-link" /><div><p className="text-sm font-semibold text-slate-800">{item.transmittal.number} · rev {item.revision}</p><p className="mt-1 text-xs text-slate-500">{human(item.transmittal.direction)} · {item.transmittal.reasonForIssue} · {fmtDate(item.transmittal.dateOfIssue)}</p><p className="mt-1 text-[11px] text-slate-400">Recipients: {item.transmittal.recipients.map((recipient) => `${recipient.name} · ${recipient.acknowledgedAt ? "acknowledged" : recipient.openedAt ? "opened" : recipient.notifiedAt ? "notified" : "pending"}`).join(", ")}</p></div></div><Chip>{human(item.transmittal.status)}</Chip></li>)}</ul> : <p className="text-sm text-slate-400">No distribution record existed for this document at this point.</p>}
        </Panel>
      </section>

      <Panel title="Relationships and packages" description="Associations that were effective at the captured point.">
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2"><div><div className="mb-3 flex items-center gap-2"><GitBranch className="h-4 w-4 text-link" /><p className="text-sm font-semibold text-slate-800">Relationships</p></div>{payload.relationships.length ? <ul className="space-y-2">{payload.relationships.map((relationship, index) => <li key={String(relationship.id ?? index)} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{String(relationship.kind ?? "relationship")} · {String(relationship.fromType ?? "item")} → {String(relationship.toType ?? "item")}</li>)}</ul> : <p className="text-xs text-slate-400">No relationships recorded.</p>}</div><div><div className="mb-3 flex items-center gap-2"><Files className="h-4 w-4 text-link" /><p className="text-sm font-semibold text-slate-800">Packages</p></div>{document.packageMembers.length ? <ul className="space-y-2">{document.packageMembers.map((member) => <li key={member.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{member.package.identifier} · required {member.requiredStatus} · {human(member.package.type)}</li>)}</ul> : <p className="text-xs text-slate-400">Not a package member at this point.</p>}</div></div>
      </Panel>
    </div>
  );
}

function eventLabel(type: string) { return human(type).replace(/^./, (letter) => letter.toUpperCase()); }
function human(value: string) { return value.replaceAll("_", " ").toLowerCase(); }

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-200 bg-surface shadow-sm"><header className="border-b border-slate-100 px-6 py-5"><h2 className="text-base font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{description}</p></header><div className="px-6 py-5">{children}</div></section>; }
function Value({ label, value, mono = false, wide = false }: { label: string; value: string | null | undefined; mono?: boolean; wide?: boolean }) { return <div className={wide ? "col-span-2" : ""}><dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{label}</dt><dd className={`mt-1 text-sm text-slate-800 ${mono ? "font-mono font-semibold" : ""}`}>{value || "—"}</dd></div>; }
function Count({ label, value }: { label: string; value: number }) { return <div className="rounded-xl bg-slate-50 px-3 py-3 text-center"><p className="text-lg font-semibold tabular-nums text-slate-800">{value}</p><p className="mt-0.5 text-[10px] font-bold uppercase text-slate-400">{label}</p></div>; }
function RevisionState({ state }: { state: string }) { const cls = state === "RELEASED" ? "bg-emerald-100 text-emerald-800 ring-emerald-200" : state === "SUPERSEDED" ? "bg-slate-100 text-slate-600 ring-slate-200" : state === "VOID" ? "bg-red-100 text-red-800 ring-red-200" : "bg-amber-100 text-amber-800 ring-amber-200"; return <Chip className={cls}>{human(state)}</Chip>; }
