import { notFound } from "next/navigation";
import { requireScope } from "@/lib/scope";
import { preflight } from "@/lib/rules/preflight";
import { PreflightPanel, Guarded } from "@/components/preflight";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import { isController, isAdmin, mayContributeToDocument } from "@/lib/auth";
import { Chip, StateChip, Banner, btn, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { DOC_STATE_LABEL, DOC_STATE_COLOR, REV_STATE_LABEL, REV_STATE_COLOR, revStateLabel, revStateColor, type DocState, type RevState } from "@/lib/standard";
import { fmtDate, timeAgo, plain } from "@/lib/utils";
import { getActiveSet, getSet, getValue } from "@/lib/config";
import { updateDocumentAction, linkAssetAction, unlinkRelationshipAction, endDocumentStateAction } from "@/lib/actions/documents";
import {
  prepareRevisionAction, uploadRevisionFilesAction, releaseRevisionAction, voidRevisionAction,
} from "@/lib/actions/revisions";
import { withdrawApprovalAction } from "@/lib/actions/governance";
import { setLegalHoldAction, disposeDocumentAction } from "@/lib/actions/retention";
import { getRunForRevision } from "@/lib/workflow";
import { WorkflowPanel, Action } from "./workflow-panel";
import { DocTabs } from "./doc-tabs";
import { ArrowLeft, ChevronRight, Download, ExternalLink, FileText, Send } from "lucide-react";
import { hasVerb } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * One document, one screen, three questions in reading order:
 *   what is it (header + details), where is it (next step), what happened (revisions, issues, history).
 * Every fact appears once. Actions live in the Next step card, or on the
 * revision they apply to — never in two places.
 */
export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const { id } = await params;
  const sp = await searchParams;

  const doc = await db.document.findUnique({
    where: { id },
    include: {
      baselineEntries: { include: { action: true }, orderBy: { requiredBy: "asc" } },
      packageMembers: { include: { package: true } },
      revisions: {
        orderBy: { createdAt: "desc" },
        include: {
          files: true,
          approvals: { orderBy: { decidedAt: "desc" } },
          cycles: { orderBy: { sequence: "asc" }, include: { comments: true, assignments: true } },
        },
      },
    },
  });
  if (!doc) notFound();

  const [rels, assets, disciplines, types, criticalities, confidentialities, retentions, phases, statuses, subprojects, suppliers, pos, auditEvents, transmittalItems] = await Promise.all([
    db.relationship.findMany({ where: { OR: [{ kind: "DOC_ASSET", fromId: id }, { kind: "DOC_ASSET", toId: id }] } }),
    db.assetItem.findMany({ orderBy: { code: "asc" } }),
    getSet("DISCIPLINES"), getSet("DOCUMENT_TYPES"), getActiveSet("CRITICALITY"), getSet("CONFIDENTIALITY"),
    getActiveSet("RETENTION_CLASSES"), getActiveSet("PHASES"), getActiveSet("STATUSES"),
    getSet("SUBPROJECTS"), getSet("SUPPLIER_CODES"), getSet("PURCHASE_ORDERS"),
    // The document's story lives on three kinds of record: the document, its
    // revisions (approval, release) and the transmittals that carried it.
    db.auditEvent.findMany({
      where: {
        OR: [
          { entityType: "Document", entityId: id },
          { entityType: "Revision", entityId: { in: doc.revisions.map((r) => r.id) } },
          { entityType: "Transmittal", entityId: { in: (await db.transmittalItem.findMany({ where: { revision: { documentId: id } }, select: { transmittalId: true } })).map((t) => t.transmittalId) } },
        ],
      },
      orderBy: { ts: "desc" },
      take: 12,
    }),
    db.transmittalItem.findMany({ where: { revision: { documentId: id } }, orderBy: { transmittal: { dateOfIssue: "desc" } }, include: { revision: true, transmittal: { include: { recipients: true } } } }),
  ]);
  const deliverable = await getValue("DELIVERABLE_TYPES", doc.deliverableType);
  const label = (rows: { code: string; label: string }[], code: string | null) => (code ? rows.find((r) => r.code === code)?.label ?? code : null);
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const assetLinks = rels.map((r) => ({ rel: r, asset: assetById.get(r.toId) ?? assetById.get(r.fromId) }));

  const canEdit = mayContributeToDocument(user, doc) && !["WITHDRAWN", "CANCELLED"].includes(doc.state);
  const controller = isController(user) || isAdmin(user);
  const inPrep = doc.revisions.find((r) => r.state === "IN_PREPARATION");
  const inReview = doc.revisions.find((r) => r.state === "IN_REVIEW");
  const current = doc.revisions.find((r) => r.state === "RELEASED");
  const working = inPrep ?? inReview ?? null;
  const shown = current ?? working ?? doc.revisions[0] ?? null;
  const pdf = shown?.files.find((f) => f.kind === "RENDITION") ?? null;
  const native = shown?.files.find((f) => f.kind === "NATIVE") ?? null;
  const workingHasPdf = !!working?.files.some((f) => f.kind === "RENDITION");
  const run = working ? await getRunForRevision(ctx, working.id) : null;
  const snapshotCount = await db.documentSnapshot.count({ where: { documentId: id } });
  const [routeRows, peopleRows] = await Promise.all([
    db.workflowTemplate.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    db.user.findMany({ select: { id: true, name: true } }),
  ]);
  const personName = new Map(peopleRows.map((p) => [p.id, p.name]));
  const routes = routeRows.map((t) => ({
    id: t.id,
    name: t.name,
    path: (JSON.parse(t.steps) as { act: string; participantIds: string[] }[]).map((st) => `${st.act === "APPROVAL" ? "approve" : "review"}: ${st.participantIds.map((pid) => personName.get(pid) ?? "?").join(", ")}`).join(" → "),
  }));
  const cycles = doc.revisions.flatMap((rev) => rev.cycles.map((c) => ({ rev, c }))).sort((x, y) => +y.c.submittedAt - +x.c.submittedAt);

  // Properties, each once, empty ones left out.
  const details: [string, string | null][] = [
    ["Type", label(types, doc.docType)],
    ["Discipline", label(disciplines, doc.discipline)],
    ["Deliverable", deliverable?.label ?? doc.deliverableType],
    ["Originator", label(suppliers, doc.originator)],
    ["Sub-project", label(subprojects, doc.subProject)],
    ["Contract / PO", label(pos, doc.contractRef)],
    ["Criticality", label(criticalities, doc.criticality)],
    ["Confidentiality", label(confidentialities, doc.confidentiality)],
    ["Retention", label(retentions, doc.retentionClass)],
    ["Received", doc.receivedDate ? fmtDate(doc.receivedDate) : null],
    ["Created", fmtDate(doc.createdDate)],
    ["Previous number", doc.previousId],
  ];

  // What the Next step card offers besides the review route itself.
  const lead = canEdit && working && !workingHasPdf ? (
    <div className="mt-1">
        <Step title={`Attach the file to rev ${working.value}`} open>
          <ActionForm action={uploadRevisionFilesAction} submitLabel="Attach" size="sm" hidden={{ revisionId: working.id }}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="PDF" hint="what people will read — needed before release">
                <input type="file" name="renditionFile" accept=".pdf" className="block w-full text-xs" />
              </Field>
              <Field label="Source file" hint="optional — the editable original">
                <input type="file" name="nativeFile" className="block w-full text-xs" />
              </Field>
            </div>
          </ActionForm>
        </Step>
    </div>
  ) : null;

  const openCycle = inReview && !run ? await db.reviewCycle.findFirst({ where: { revisionId: inReview.id, status: "OPEN" }, orderBy: { sequence: "desc" }, select: { id: true } }) : null;
  const extra = (
    <div className="mt-1 flex flex-wrap items-start gap-x-2 empty:hidden">
      {/* No separate approval: the review's binding verdict is the decision. */}
      {openCycle ? (
        <Link href={`/reviews/${openCycle.id}`} className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-surface px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Review of rev {inReview?.value} — comments and verdict →
        </Link>
      ) : null}

      {controller && working ? (
        <Step title={`Release rev ${working.value}`} open={run?.status === "DONE" || working.approvals.some((a) => !a.withdrawnAt)}>
          <PreflightPanel result={await preflight("RELEASE", { revisionId: working.id }, ctx)} className="mb-3" />
          {working.proposedStatus ? (
            <>
              <p className="mb-3 rounded-xl bg-tint px-3.5 py-2.5 text-xs text-brand-ink">
                The reviewers decided it may be used for <strong>{working.proposedStatus} — {label(statuses, working.proposedStatus)}</strong>.
                Releasing makes that the current revision at that status. You do not choose it.
              </p>
              <ActionForm action={releaseRevisionAction} submitLabel={`Release as ${working.proposedStatus}`} size="sm" hidden={{ revisionId: working.id, statusCode: working.proposedStatus }} />
            </>
          ) : (
            <ActionForm action={releaseRevisionAction} submitLabel="Release" size="sm" hidden={{ revisionId: working.id }}>
              <Field label="Released as" required hint="older revisions have no decided status; newer ones carry the reviewers' choice">
                <select name="statusCode" className={inputCls} defaultValue="">
                  <option value="" disabled>Choose a status…</option>
                  {statuses.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.label}</option>)}
                </select>
              </Field>
            </ActionForm>
          )}
          {current ? <p className="mt-2 text-[11px] text-slate-500">Rev {current.value} will be marked superseded.</p> : null}
        </Step>
      ) : null}

      {canEdit && !working && doc.kind !== "RECORD" ? (
        <Step title={doc.revisions.length ? "New revision — e.g. a resubmission arrived" : "Start the first revision"} open={!doc.revisions.length}>
          <ActionForm action={prepareRevisionAction} submitLabel="Start revision" hidden={{ documentId: doc.id }}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={doc.revisions.length ? "Why it is changing" : "Reason"} required className="sm:col-span-2"><input name="reasonForRevision" className={inputCls} defaultValue={doc.revisions.length ? "" : "First issue"} /></Field>
              <Field label={doc.revisions.length ? "What changed" : "Description"} required className="sm:col-span-2"><input name="changeDescription" className={inputCls} defaultValue={doc.revisions.length ? "" : "Initial version"} /></Field>
              <Field label="Due for submission"><input type="date" name="plannedSubmissionDate" className={inputCls} /></Field>
              <Field label="Phase">
                <select name="phase" className={inputCls} defaultValue="">
                  <option value="">—</option>
                  {phases.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
                </select>
              </Field>
              {!doc.isPlaceholder && !outstandingAuth(doc.revisions) ? <Field label="Authorised because" className="sm:col-span-2"><input name="authorizationReason" className={inputCls} /></Field> : null}
              <Field label="File" hint="optional — a PDF shows in the viewer" className="sm:col-span-2"><input type="file" name="revisionFile" className="block w-full text-xs" /></Field>
              {routes.length ? (
                <Field label="Then" hint="needs the file above" className="sm:col-span-2">
                  <select name="sendTemplateId" className={inputCls} defaultValue="">
                    <option value="">Just create the revision</option>
                    {routes.map((r) => <option key={r.id} value={r.id}>Send for approval — {r.name} ({r.path})</option>)}
                  </select>
                </Field>
              ) : null}
            </div>
          </ActionForm>
        </Step>
      ) : null}
    </div>
  );

  const stateLabel = shown ? revStateLabel(shown.state, !!shown.proposedStatus) : DOC_STATE_LABEL[doc.state as DocState] ?? doc.state;
  const stateColor = shown ? revStateColor(shown.state, !!shown.proposedStatus) : DOC_STATE_COLOR[doc.state as DocState] ?? "";

  return (
    <div className="space-y-4">
      {sp.sent ? <Banner tone="good" title="Registered and sent for approval">It is now with the people shown below. You will be notified when they decide.</Banner> : null}
      {sp.sendError ? <Banner tone="warn" title="Registered, but not sent">{sp.sendError} Send it from the step below.</Banner> : null}
      {sp.released ? (
        <Banner tone="good" title={`Released${sp.superseded ? ` · rev ${sp.superseded} superseded` : ""}`}>
          This revision is now the one in use. Releasing does not tell anyone: send it on a transmittal, where you choose who receives it and why.
          {current ? <Link href={`/transmittals/new?revisions=${current.id}`} className="ml-1 font-semibold text-emerald-900 underline">Issue it now →</Link> : null}
        </Banner>
      ) : null}

      {/* What is it */}
      <header className="rounded-2xl border border-slate-200 bg-surface px-5 py-4 shadow-sm">
        <Link href="/documents" className="inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> Documents</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-sm font-bold text-slate-500">{doc.docNumber}</p>
            <h1 className="mt-0.5 text-xl font-semibold text-slate-950">{doc.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {shown ? <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono font-bold text-slate-700">Rev {shown.value}</span> : null}
              <StateChip label={stateLabel} color={stateColor} />
              {shown?.statusCode ? <span>{shown.statusCode} · {label(statuses, shown.statusCode)}</span> : shown?.proposedStatus ? <span className="text-slate-500">to be {shown.proposedStatus} once released</span> : null}
              {current && working ? <span className="text-amber-700">· rev {working.value} in progress</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {pdf ? <a href={`/api/files/${pdf.id}`} target="_blank" className={btn("primary", "sm")}><ExternalLink className="h-4 w-4" /> Open PDF</a> : null}
            {native ? <a href={`/api/files/${native.id}?dl=1`} className={btn("secondary", "sm")}><Download className="h-4 w-4" /> Source file</a> : null}
            {current ? <Link href={`/transmittals/new?doc=${doc.id}`} className={btn("secondary", "sm")}><Send className="h-4 w-4" /> Send out</Link> : null}
          </div>
        </div>
      </header>

      {/* Where is it — always in view */}
      <section id="workflow" className="scroll-mt-28">
        <WorkflowPanel doc={doc} user={user} lead={lead} extra={extra} />
      </section>

      {/* Everything else, one tab at a time */}
      <DocTabs
        tabs={[
          {
            id: "viewer",
            label: "Preview",
            content: pdf ? (
              <iframe src={`/api/files/${pdf.id}`} title={`${doc.docNumber} rev ${shown?.value ?? ""}`} className="h-[70vh] min-h-[480px] w-full bg-slate-100" />
            ) : (
              <div className="grid h-48 place-items-center p-6 text-center">
                <div>
                  <FileText className="mx-auto h-8 w-8 text-slate-400" />
                  <p className="mt-2 text-sm font-semibold text-slate-700">No PDF to show yet</p>
                  <p className="mt-1 text-xs text-slate-500">{working ? `Attach one to rev ${working.value} in the step above.` : "Start a revision to add content."}</p>
                </div>
              </div>
            ),
          },
          {
            id: "metadata",
            label: "Details",
            content: (
              <div className="p-5">
                <dl className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
                  {details.filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-4 border-b border-slate-100 py-2">
                      <dt className="text-xs text-slate-500">{k}</dt>
                      <dd className="text-right text-xs font-semibold text-slate-800">{v}</dd>
                    </div>
                  ))}
                </dl>
                {canEdit ? (
                  <details className="mt-4">
                    <summary className="cursor-pointer list-none text-xs font-semibold text-link">Edit details</summary>
                    <div className="mt-3 max-w-2xl">
                      <ActionForm action={updateDocumentAction} submitLabel="Save" size="sm" hidden={{ id: doc.id }}>
                        <Field label="Title" required><input name="title" defaultValue={doc.title} className={inputCls} /></Field>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <Field label="Type"><select name="docType" defaultValue={doc.docType} className={inputCls}>{types.filter((t) => t.status === "ACTIVE").map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></Field>
                          <Field label="Discipline"><select name="discipline" defaultValue={doc.discipline} className={inputCls}>{disciplines.filter((d) => d.status === "ACTIVE").map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}</select></Field>
                          <Field label="Criticality"><select name="criticality" defaultValue={doc.criticality ?? ""} className={inputCls}><option value="">—</option>{criticalities.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select></Field>
                          <Field label="Confidentiality"><select name="confidentiality" defaultValue={doc.confidentiality ?? ""} className={inputCls}>{confidentialities.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select></Field>
                          <Field label="Retention"><select name="retentionClass" defaultValue={doc.retentionClass ?? ""} className={inputCls}><option value="">—</option>{retentions.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</select></Field>
                          <Field label="Received"><input type="date" name="receivedDate" defaultValue={doc.receivedDate?.toISOString().slice(0, 10) ?? ""} className={inputCls} /></Field>
                          <Field label="Previous number"><input name="previousId" defaultValue={doc.previousId ?? ""} className={inputCls} /></Field>
                        </div>
                        <input type="hidden" name="appVersion" value={doc.appVersion ?? ""} />
                        <input type="hidden" name="legacyScheme" value={doc.legacyScheme ?? ""} />
                      </ActionForm>
                    </div>
                  </details>
                ) : null}
                {controller ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer list-none text-xs font-semibold text-slate-500">Retire or hold this document…</summary>
                    <div className="mt-3 max-w-md space-y-4">
                      {doc.disposedAt ? (
                        <p className="text-xs text-slate-500">Disposed {fmtDate(doc.disposedAt)} by {doc.disposedBy} · {doc.disposalBasis}</p>
                      ) : (
                        <>
                          <ActionForm action={setLegalHoldAction} submitLabel={doc.legalHold ? "Lift legal hold" : "Put on legal hold"} size="sm" variant="secondary" hidden={{ documentId: doc.id, hold: doc.legalHold ? "off" : "on" }} />
                          {doc.state === "ACTIVE" ? (
                            <ActionForm action={endDocumentStateAction} submitLabel="Retire" variant="danger" size="sm" hidden={{ documentId: doc.id }} confirmText="People who received it will be told to stop using it. Continue?">
                              <Field label="Retire as">
                                <select name="kind" className={inputCls} defaultValue="WITHDRAWN">
                                  <option value="WITHDRAWN">Withdrawn</option>
                                  <option value="CANCELLED">Cancelled</option>
                                  <option value="ARCHIVED">Archived</option>
                                </select>
                              </Field>
                              <Field label="Reason" required><input name="reason" className={inputCls} /></Field>
                            </ActionForm>
                          ) : null}
                          <ActionForm action={disposeDocumentAction} submitLabel="Record disposal" size="sm" variant="danger" hidden={{ documentId: doc.id }} confirmText="Disposal is permanent. Continue?">
                            <input name="basis" className={inputCls} placeholder="Basis and who authorised it" />
                          </ActionForm>
                        </>
                      )}
                    </div>
                  </details>
                ) : null}
              </div>
            ),
          },
          {
            id: "revisions",
            label: "Revisions",
            count: doc.revisions.length,
            content: doc.revisions.length ? (
              <ul className="divide-y divide-slate-100">
                {doc.revisions.map((rev) => (
                  <RevisionRow key={rev.id} rev={rev} statusLabel={label(statuses, rev.statusCode)} controller={controller} userId={user.id} userRole={user.role} />
                ))}
              </ul>
            ) : <Empty>No revision yet.</Empty>,
          },
          {
            id: "reviews",
            label: "Reviews",
            count: cycles.length,
            content: cycles.length ? (
              <ul className="divide-y divide-slate-100">
                {cycles.map(({ rev, c }) => (
                  <li key={c.id}>
                    <Link href={`/reviews/${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-slate-50">
                      <span className="font-mono text-xs font-bold text-slate-900">Rev {rev.value}</span>
                      <span className="text-xs text-slate-500">review {c.sequence}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                        {c.status === "OPEN" ? `with ${c.assignments.map((a) => a.userName).join(", ") || "nobody yet"}` : prettyState(c.outcome ?? "closed")}
                      </span>
                      {c.comments.length ? <span className="text-[11px] text-slate-500">{c.comments.length} comment{c.comments.length === 1 ? "" : "s"}</span> : null}
                      {c.comments.some((x) => x.progressionPreventing && x.status === "OPEN") ? <Chip className="bg-red-100 text-red-700 ring-red-300">blocking</Chip> : null}
                      <span className="text-[11px] text-slate-400">{fmtDate(c.submittedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <Empty>Never sent for review.</Empty>,
          },
          {
            id: "distribution",
            label: "Sent out",
            count: transmittalItems.length,
            content: (
              <>
                {transmittalItems.length ? (
                  <ul className="divide-y divide-slate-100">
                    {transmittalItems.map((item) => {
                      const t = item.transmittal;
                      const acked = t.recipients.filter((r) => r.acknowledgedAt).length;
                      return (
                        <li key={item.id}>
                          <Link href={`/transmittals/${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-slate-50">
                            <span className="font-mono text-xs font-bold text-link">{t.number}</span>
                            <span className="text-xs text-slate-500">rev {item.revision.value} · {prettyState(t.reasonForIssue)} · {fmtDate(t.dateOfIssue)}</span>
                            <span className="min-w-0 flex-1 truncate text-xs text-slate-700">{t.recipients.map((r) => r.name).join(", ") || "—"}</span>
                            <span className={`text-[11px] font-semibold ${acked === t.recipients.length && acked ? "text-emerald-700" : "text-slate-500"}`}>{acked}/{t.recipients.length} acknowledged</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : <Empty>Not sent to anyone yet.</Empty>}
              </>
            ),
          },
          {
            id: "relationships",
            label: "Used in",
            count: doc.baselineEntries.length + doc.packageMembers.length + assetLinks.length,
            content: (
              <div className="px-5 py-2">
                {doc.baselineEntries.length + doc.packageMembers.length + assetLinks.length === 0 ? (
                  <p className="py-3 text-xs text-slate-400">Not linked to any schedule action, package or asset.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {doc.baselineEntries.map((e) => (
                      <UsedIn key={e.id} kind="Schedule action" href={`/actions/${e.action.code}`} code={e.action.code} text={`${e.action.name} — needs ${e.requiredStatus} by ${fmtDate(e.requiredBy)}`} />
                    ))}
                    {doc.packageMembers.map((m) => (
                      <UsedIn key={m.id} kind="Package" href={`/packages/${m.package.identifier}`} code={m.package.identifier} text={`${m.package.recipientName} — needs ${m.requiredStatus}`} />
                    ))}
                    {assetLinks.map(({ rel, asset }) => asset ? (
                      <UsedIn key={rel.id} kind="Asset" href={`/assets/${asset.id}`} code={asset.code} text={asset.name}>
                        {canEdit ? (
                          <form action={unlinkRelationshipAction}>
                            <input type="hidden" name="relationshipId" value={rel.id} />
                            <input type="hidden" name="documentId" value={doc.id} />
                            <button className="text-[11px] text-red-600 hover:underline">Remove</button>
                          </form>
                        ) : null}
                      </UsedIn>
                    ) : null)}
                  </ul>
                )}
                {canEdit ? (
                  <details className="border-t border-slate-100 py-3">
                    <summary className="cursor-pointer list-none text-xs font-semibold text-link">+ Link an asset</summary>
                    <div className="mt-2 max-w-md">
                      <ActionForm action={linkAssetAction} submitLabel="Link" size="sm" hidden={{ documentId: doc.id }}>
                        <select name="assetCode" className={inputCls} defaultValue="">
                          <option value="" disabled>Choose…</option>
                          {assets.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                        </select>
                      </ActionForm>
                    </div>
                  </details>
                ) : null}
              </div>
            ),
          },
          {
            id: "activity",
            label: "History",
            content: (
              <div>
                {auditEvents.length ? (
                  <ul className="divide-y divide-slate-100 px-5">
                    {auditEvents.map((e) => (
                      <li key={e.id} className="flex items-start justify-between gap-4 py-2.5">
                        <p className="text-xs text-slate-700">
                          <span className="font-semibold">{e.actorName}</span> {prettyState(e.action)}
                          {e.entityType === "Revision" && e.entityLabel ? <span className="text-slate-500"> · {e.entityLabel.replace(doc.docNumber, "").trim()}</span> : e.entityType === "Transmittal" && e.entityLabel ? <span className="text-slate-500"> · {e.entityLabel}</span> : null}
                          {e.field ? <span className="text-slate-400"> · {e.field}: {e.oldValue ?? "—"} → {e.newValue ?? "—"}</span> : e.newValue ? <span className="text-slate-400"> · {plain(e.newValue)}</span> : e.detail ? <span className="text-slate-400"> · {plain(e.detail)}</span> : null}
                        </p>
                        <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(e.ts)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <Empty>Nothing recorded yet.</Empty>}
                {snapshotCount ? <Link href={`/documents/${doc.id}/history`} className="block border-t border-slate-100 px-5 py-3 text-xs font-semibold text-link hover:underline">See the document as it was at each recorded point →</Link> : null}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-6 text-center text-xs text-slate-400">{children}</p>;
}

function Step({ title, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return <Action label={title} secondary>{children}</Action>;
}

function UsedIn({ kind, href, code, text, children }: { kind: string; href: string; code: string; text: string; children?: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-2 py-2.5">
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{kind}</p>
        <Link href={href} className="font-mono text-xs font-bold text-link hover:underline">{code}</Link>
        <p className="truncate text-xs text-slate-600">{text}</p>
      </div>
      {children}
    </li>
  );
}

function prettyState(value: string) { return value.replaceAll("_", " ").toLowerCase(); }

function outstandingAuth(revs: { state: string; cycles: { outcome: string | null; returnedToOriginatorAt: Date | null }[] }[]): boolean {
  const last = revs[0];
  if (!last) return false;
  return last.cycles.some((c) => ["REVISE_AND_RESUBMIT", "APPROVED_WITH_COMMENTS", "REJECTED"].includes(c.outcome ?? "") && c.returnedToOriginatorAt);
}

type RevData = Prisma.RevisionGetPayload<{
  include: { files: true; approvals: true; cycles: { include: { comments: true; assignments: true } } };
}>;

/** One line per revision; its record and its per-revision controls open in place. */
function RevisionRow({ rev, statusLabel, controller, userId, userRole }: { rev: RevData; statusLabel: string | null; controller: boolean; userId: string; userRole: string }) {
  const state = rev.state as RevState;
  const pdf = rev.files.find((f) => f.kind === "RENDITION");
  const native = rev.files.find((f) => f.kind === "NATIVE");
  const approval = rev.approvals[0];
  const facts: [string, string | null][] = [
    ["Why", rev.reasonForRevision],
    ["What changed", rev.changeDescription],
    ["Phase", rev.phase],
    ["Due", rev.plannedSubmissionDate ? fmtDate(rev.plannedSubmissionDate) : null],
    ["Issued", rev.issueDate ? fmtDate(rev.issueDate) : null],
    ["Authorised", rev.authorizationReason ? `${rev.authorizationReason}${rev.authorizedByName ? ` — ${rev.authorizedByName}` : ""}` : null],
  ];

  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-slate-50">
          <ChevronRight className="h-3.5 w-3.5 text-slate-400 transition group-open:rotate-90" />
          <span className="font-mono text-sm font-bold text-slate-900">Rev {rev.value}</span>
          <StateChip label={REV_STATE_LABEL[state] ?? rev.state} color={REV_STATE_COLOR[state] ?? ""} />
          {rev.statusCode ? <span className="text-xs text-slate-500">{rev.statusCode} · {statusLabel}</span> : null}
          <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{rev.changeDescription ?? ""}</span>
          <span className="text-[11px] text-slate-400">{fmtDate(rev.releasedAt ?? rev.createdAt)}</span>
        </summary>
        <div className="space-y-3 bg-slate-50/60 px-5 py-4 pl-11">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {facts.filter(([, v]) => v).map(([k, v]) => (
              <div key={k}><dt className="text-[11px] text-slate-400">{k}</dt><dd className="text-xs text-slate-800">{v}</dd></div>
            ))}
          </dl>

          <div className="flex flex-wrap gap-2 text-xs">
            {pdf ? <a href={`/api/files/${pdf.id}`} target="_blank" className="font-semibold text-link hover:underline">PDF</a> : <span className="text-slate-400">no PDF</span>}
            {native ? <a href={`/api/files/${native.id}?dl=1`} className="font-semibold text-link hover:underline">Source file</a> : null}
          </div>


          {approval ? (
            <p className="text-xs text-slate-600">
              {approval.withdrawnAt
                ? <><span className="font-semibold text-red-700">Approval withdrawn</span> by {approval.withdrawnBy}, {fmtDate(approval.withdrawnAt)} — {approval.withdrawnReason}</>
                : <><span className="font-semibold text-slate-800">Approved</span> by {approval.approverName}, {fmtDate(approval.decidedAt)}</>}
            </p>
          ) : null}

          {approval && !approval.withdrawnAt && (userId === approval.approverId || userRole === "ADMIN") ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-red-700">Withdraw this approval…</summary>
              <div className="mt-2 max-w-md">
                <ActionForm action={withdrawApprovalAction} submitLabel="Withdraw approval" variant="danger" size="sm" hidden={{ revisionId: rev.id }}>
                  <input name="reason" className={inputCls} placeholder="Reason" />
                </ActionForm>
              </div>
            </details>
          ) : null}

          {controller && state === "RELEASED" ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-red-700">Void — issued in error…</summary>
              <div className="mt-2 max-w-md">
                <ActionForm action={voidRevisionAction} submitLabel="Void revision" variant="danger" size="sm" hidden={{ revisionId: rev.id }}>
                  <Field label="Reason" required><input name="voidReason" className={inputCls} placeholder="e.g. issued against the wrong contract" /></Field>
                  <Field label="Impact on work already done" hint="can be added later"><input name="reassessment" className={inputCls} /></Field>
                </ActionForm>
              </div>
            </details>
          ) : null}

          {state === "SUPERSEDED" ? <Chip className="bg-violet-50 text-violet-700 ring-violet-200">replaced — do not use</Chip> : null}
          {state === "VOID" ? <Chip className="bg-red-50 text-red-700 ring-red-200">void — never valid</Chip> : null}
        </div>
      </details>
    </li>
  );
}
