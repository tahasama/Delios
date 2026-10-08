import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { api, ApiProblem } from "@/lib/api/client";
import type { Distribution, DocumentContext, DocumentView, IssueRequestView, ListValue, RouteView } from "@/lib/api/types";
import { requireSession, projectPath } from "@/lib/session";
import { isMigrated } from "@/lib/migrated";
import { DOCUMENT_STATES, REVISION_STATES } from "@/lib/states";
import { Card, Chip, KeyValue, PageHeader } from "@/components/ui";
import { Arrival, Resubmit, SendForReview, StartRevision } from "./acts";
import { OpenRequest, RequestIssue } from "./issue";

export const dynamic = "force-dynamic";

function day(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";
}

function size(bytes: number): string {
  return bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** A link when the screen works, otherwise plain text. */
function To({ href, children }: { href: string; children: React.ReactNode }) {
  return isMigrated(href) ? <Link href={href} className="font-semibold text-link hover:underline">{children}</Link> : <span className="font-semibold">{children}</span>;
}

/**
 * One document: what it is, every revision with its files and submissions, what
 * can be done with it now (start a revision, send corrected files, Document
 * Control's check, send for review), and everything around it: reviews,
 * transmittals, packages, the activities that need it, and its history.
 */
export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  let doc: DocumentView;
  try {
    doc = await api<DocumentView>(projectPath(session, `/documents/${id}`));
  } catch (e) {
    if (e instanceof ApiProblem && e.status === 404) notFound();
    throw e;
  }
  const [context, lists] = await Promise.all([
    api<DocumentContext>(projectPath(session, `/documents/${id}/context`)),
    api<Record<string, ListValue[]>>("/api/values", {
      query: { sets: "DISCIPLINES,DOCUMENT_TYPES,DELIVERABLE_TYPES,CRITICALITY,CONFIDENTIALITY,RETENTION_CLASSES,STATUSES,REVIEW_OUTCOMES,CONTROL_OUTCOMES,REASONS_FOR_ISSUE" },
    }),
  ]);
  const label = (set: string, code: string | null) => (code ? lists[set]?.find((v) => v.code === code)?.label ?? code : "—");

  const revisions = [...doc.revisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = revisions[0] ?? null;
  const inMotion = latest && ["RECEIVED", "CORRECTING", "IN_PREPARATION", "IN_REVIEW"].includes(latest.state);
  const contributes = session.can("CREATE") || session.can("REVISE");
  const control = session.can("CONTROL");
  const released = revisions.find((r) => r.state === "RELEASED") ?? null;
  const [distribution, requests] = released && session.user.isInternal
    ? await Promise.all([
        api<Distribution>(projectPath(session, `/documents/${id}/distribution`)).catch(() => null),
        api<IssueRequestView[]>(projectPath(session, `/revisions/${released.id}/issue-requests`)).catch(() => [] as IssueRequestView[]),
      ])
    : [null, [] as IssueRequestView[]];
  const openRequests = requests.filter((r) => r.status === "OPEN");
  const routes = latest?.state === "IN_PREPARATION" && latest.filesState === "READY" && contributes
    ? await api<RouteView[]>(projectPath(session, `/documents/${id}/routes`)).catch(() => [])
    : [];

  return (
    <div className="space-y-4">
      <Link href="/documents" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5" /> Register</Link>
      <PageHeader eyebrow={doc.number} title={doc.title}
        subtitle={`${label("DOCUMENT_TYPES", doc.docType)} · ${label("DISCIPLINES", doc.discipline)} · ${DOCUMENT_STATES[doc.state]?.label ?? doc.state}`}
        actions={latest ? <Chip title={REVISION_STATES[latest.state]?.means}>rev {latest.value} · {REVISION_STATES[latest.state]?.label ?? latest.state}{latest.statusCode ? ` · ${latest.statusCode}` : ""}</Chip> : <Chip>No revision yet</Chip>} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title="Revisions" description={revisions.length ? `${revisions.length}, newest first` : undefined}>
            {revisions.length === 0 ? <p className="text-sm text-slate-500">Nothing has been submitted under this number yet.</p> : (
              <ul className="divide-y divide-line">
                {revisions.map((r) => (
                  <li key={r.id} className="py-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold">rev {r.value}</span>
                      <Chip title={REVISION_STATES[r.state]?.means}>{REVISION_STATES[r.state]?.label ?? r.state}</Chip>
                      {r.statusCode ? <Chip title={label("STATUSES", r.statusCode)}>{r.statusCode}</Chip> : null}
                      <span className="text-[11px] text-slate-400">by {r.authoredByName}, {day(r.createdAt)}{r.releasedAt ? ` · released ${day(r.releasedAt)}` : ""}</span>
                    </div>
                    {r.reasonForRevision || r.changeDescription ? <p className="mt-1 text-xs text-slate-600">{[r.reasonForRevision, r.changeDescription].filter(Boolean).join(": ")}</p> : null}
                    {r.returnedReason ? <p className="mt-1 text-xs text-amber-800">Returned: {r.returnedReason}</p> : null}
                    {r.submissions.length > 1 || r.submissions.some((s) => s.outcome) ? (
                      <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                        {r.submissions.map((s) => <li key={s.number}>Submission {s.number}: sent by {s.submittedBy}, {day(s.submittedAt)}{s.outcome ? ` · ${label("CONTROL_OUTCOMES", s.outcome)}${s.decidedBy ? ` by ${s.decidedBy}` : ""}` : ""}{s.note ? `: ${s.note}` : ""}</li>)}
                      </ul>
                    ) : null}
                    <ul className="mt-2 space-y-1">
                      {r.files.filter((f) => f.status !== "AWAITING_UPLOAD").map((f) => (
                        <li key={f.id} className="flex flex-wrap items-center gap-2 text-xs">
                          {f.status === "CLEAN"
                            ? <a href={`/api/files/${f.id}`} className="inline-flex items-center gap-1 font-semibold text-link hover:underline"><Download className="h-3.5 w-3.5" />{f.name}</a>
                            : <span className="font-semibold text-slate-600">{f.name}</span>}
                          <span className="text-slate-400">{f.kind.toLowerCase()} · {size(f.size)} · submission {f.submission}</span>
                          {f.status !== "CLEAN" ? <Chip className="bg-amber-50 text-amber-800 ring-amber-200">{f.status === "PROCESSING" ? "being scanned" : f.status.toLowerCase()}{f.statusDetail ? `: ${f.statusDetail}` : ""}</Chip> : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Reviews">
            {context.reviews.length === 0 ? <p className="text-sm text-slate-500">No review yet.</p> : (
              <ul className="divide-y divide-line text-sm">
                {context.reviews.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span><To href={`/reviews/${r.id}`}>{r.number}</To> · rev {r.revision} · {r.routeName}</span>
                    <span className="text-xs text-slate-500">{r.state.replaceAll("_", " ").toLowerCase()}{r.verdict ? ` · ${r.verdict}` : ""}{r.grantedStatus ? ` → ${r.grantedStatus}` : ""} · {day(r.startedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Issued on">
            {context.transmittals.length === 0 ? <p className="text-sm text-slate-500">Not sent on any transmittal yet.</p> : (
              <ul className="divide-y divide-line text-sm">
                {context.transmittals.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span><To href={`/transmittals/${t.id}`}>{t.number}</To> · rev {t.revision} · to {t.toName}</span>
                    <span className="text-xs text-slate-500">{label("REASONS_FOR_ISSUE", t.reason)}{t.forReview ? " (review)" : ""} · {day(t.issuedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="History" description="From the audit trail, newest first">
            <ul className="space-y-1.5 text-xs">
              {context.history.map((e, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-24 shrink-0 text-slate-400">{day(e.at)}</span>
                  <span className="min-w-0"><span className="font-semibold text-slate-700">{e.action.replaceAll("_", " ").toLowerCase()}</span>{e.entityType === "Revision" && e.entityLabel ? ` · ${e.entityLabel}` : ""}{e.actor ? ` · ${e.actor}` : ""}{e.detail ? <span className="block text-slate-500">{e.detail}</span> : null}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          {latest?.state === "RECEIVED" && control ? (
            <Card title="Document Control: check what arrived" description="Before anyone reviews it">
              {latest.filesState === "PROCESSING" ? <p className="text-xs text-slate-500">The files are still being scanned.</p>
                : <Arrival documentId={doc.id} revisionId={latest.id} outcomes={lists.CONTROL_OUTCOMES ?? []} />}
            </Card>
          ) : null}
          {latest?.state === "CORRECTING" && contributes ? (
            <Card title="Send it corrected" description="Under the same revision">
              {latest.returnedReason ? <p className="mb-2 text-xs text-amber-800">{latest.returnedReason}</p> : null}
              <Resubmit documentId={doc.id} revisionId={latest.id} />
            </Card>
          ) : null}
          {latest?.state === "IN_PREPARATION" && contributes ? (
            <Card title="Send for review">
              {latest.filesState === "PROCESSING" ? <p className="text-xs text-slate-500">The files are still being scanned.</p>
                : latest.filesState === "REJECTED" ? <p className="text-xs text-red-700">A file was refused by the scan: start again with clean files.</p>
                : routes.length ? <SendForReview documentId={doc.id} revisionId={latest.id} routes={routes} />
                : <p className="text-xs text-slate-500">No review route serves this document. An administrator sets the routes.</p>}
            </Card>
          ) : null}
          {!inMotion && contributes && doc.state !== "WITHDRAWN" && doc.state !== "CANCELLED" && doc.state !== "ARCHIVED" ? (
            <Card title={latest ? "Next revision" : "First revision"}>
              <StartRevision documentId={doc.id} first={!latest} />
            </Card>
          ) : null}

          {released && distribution ? (
            <Card title="Issue it" description={`rev ${released.value}${released.statusCode ? ` · ${released.statusCode}` : ""}`}>
              <div className="space-y-4">
                {openRequests.map((r) => <OpenRequest key={r.id} documentId={doc.id} request={r} control={control || session.can("TRANSMIT")} reasonLabel={label("REASONS_FOR_ISSUE", r.reason)} />)}
                <RequestIssue documentId={doc.id} revisionId={released.id} distribution={distribution}
                  reasons={(lists.REASONS_FOR_ISSUE ?? []).filter((v) => v.status === "ACTIVE").map((v) => ({ code: v.code, label: v.label }))} />
              </div>
            </Card>
          ) : null}

          <Card title="About it">
            <KeyValue items={[
              { label: "Deliverable type", value: label("DELIVERABLE_TYPES", doc.deliverableType) },
              { label: "Originator", value: doc.originator ?? "Us" },
              { label: "Subproject", value: doc.subproject ?? "—" },
              { label: "Contract", value: doc.contractRef ?? "—" },
              { label: "Criticality", value: label("CRITICALITY", doc.criticality) },
              { label: "Confidentiality", value: label("CONFIDENTIALITY", doc.confidentiality) },
              { label: "Kept for", value: label("RETENTION_CLASSES", doc.retentionClass) },
              { label: "Planned", value: day(doc.plannedDate) || "—" },
              ...(doc.receivedDate ? [{ label: "Received", value: day(doc.receivedDate) }] : []),
              { label: "Registered", value: `${day(doc.createdAt)} by ${doc.createdByName}` },
            ]} />
          </Card>

          {context.activities.length ? (
            <Card title="Needed by">
              <ul className="space-y-1.5 text-xs">
                {context.activities.map((a) => (
                  <li key={`${a.activityId}${a.purpose}`}><To href={`/actions/${a.activityId}`}>{a.code}</To> {a.name} · {label("REASONS_FOR_ISSUE", a.purpose)}{a.neededBy ? ` · by ${day(a.neededBy)}` : ""} · <span className={a.state === "MISSING" ? "text-red-700" : "text-emerald-700"}>{a.state.toLowerCase()}</span>{a.waiverNote ? ` (${a.waiverNote})` : ""}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {context.packages.length ? (
            <Card title="In packages">
              <ul className="space-y-1 text-xs">
                {context.packages.map((p) => <li key={p.id}><To href={`/packages/${p.id}`}>{p.number}</To> {p.title} · {p.state.toLowerCase()}</li>)}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
