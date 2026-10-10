import { ReadersPanel } from "./readers-panel";
import { documentAssets, projectAssets } from "@/lib/api/records";
import { documentReaders, projectReaders } from "@/lib/api/readers";
import { openConfidentiality } from "@/lib/permissions";
import { controlDoes } from "@/lib/control-activities";
import { notFound } from "next/navigation";
import { requireScope } from "@/lib/scope";
import { preflight } from "@/lib/rules/preflight";
import { PreflightPanel, Guarded } from "@/components/preflight";
import Link from "next/link";
import { isController, isAdmin, mayContributeToDocument } from "@/lib/auth";
import { Chip, StateChip, Banner, btn, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { Asked, Added } from "@/components/policy-fields";
import { DOC_STATE_LABEL, DOC_STATE_COLOR, REV_STATE_COLOR, revStateColor, type DocState, type RevState } from "@/lib/standard";
import { stateNames, stateName } from "@/lib/state-names";
import { revisionGround } from "@/lib/revision-ground";
import { typeSkipsReview } from "@/lib/review-need";
import { ownFields, readExtras, formPolicy } from "@/lib/field-policy";
import { fmtDate, timeAgo, plain } from "@/lib/utils";
import { getActiveSet, getSet, getValue } from "@/lib/config";
import { updateDocumentAction, reinstateDocumentAction, linkAssetAction, unlinkRelationshipAction, endDocumentStateAction } from "@/lib/actions/documents";
import {
  prepareRevisionAction, editRevisionAction, withdrawRevisionAction, releaseRevisionAction, voidRevisionAction, unvoidRevisionAction, returnAtGateAction, liftHoldAction, returnHeldAction,
} from "@/lib/actions/revisions";
import { parseRecipients, mayRequestIssue, requestChoices, authorOf, issuePolicy, decisionLetsItOut, requestsOn } from "@/lib/issue-requests";
import { legacyDocument, documentContext, type LegacyRevision } from "@/lib/api/legacy";
import { requestIssueAction, carryOutRequestAction, cancelRequestAction } from "@/lib/actions/issue-requests";
import { RequestIssue } from "./request-issue";
import { ReturnTarget } from "./return-target";
import { CopyPicker } from "@/app/(app)/transmittals/new/recipient-picker";
import { recipientCompanies } from "@/lib/recipients";
import { withdrawApprovalAction } from "@/lib/actions/governance";
import { setLegalHoldAction } from "@/lib/actions/retention";
import { getRunForRevision } from "@/lib/workflow";
import { WorkflowPanel } from "./workflow-panel";
import type { StepItem } from "./next-step";
import { SupplierDelivery } from "./supplier-delivery";
import { Timeline } from "@/components/timeline";
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
  const { user } = ctx;
  const { id } = await params;
  const sp = await searchParams;

  const doc = await legacyDocument(ctx, id);
  if (!doc) notFound();

  const context = await documentContext(ctx, id);
  const [rels, assets, disciplines, types, criticalities, confidentialities, retentions, phases, statuses, subprojects, suppliers, pos, auditEvents, transmittalItems] = await Promise.all([
    documentAssets(ctx, id).then((links) => links.map((one) => ({ id: one.id, kind: "DOC_ASSET", fromId: id, toId: one.assetId }))),
    projectAssets(ctx).then((all) => all.map((one) => ({ id: one.id, code: one.code, name: one.name }))),
    getSet("DISCIPLINES"), getSet("DOCUMENT_TYPES"), getActiveSet("CRITICALITY"), getSet("CONFIDENTIALITY"),
    getActiveSet("RETENTION_CLASSES"), getActiveSet("PHASES"), getActiveSet("STATUSES"),
    getSet("SUBPROJECTS"), getSet("SUPPLIER_CODES"), getSet("PURCHASE_ORDERS"),
    // The document's story lives on three kinds of record: the document, its
    // revisions (approval, release) and the transmittals that carried it.
    // Every event, with its reason: nothing drops out of the History tab.
    Promise.resolve(context.history.map((one, index) => ({
      id: `${index}`, actorName: one.actor ?? "System", action: one.action, entityType: one.entityType, entityId: one.entityId ?? null, entityLabel: one.entityLabel,
      field: null as string | null, oldValue: null as string | null, newValue: null as string | null, detail: one.detail, ts: new Date(one.at),
    }))),
    Promise.resolve(context.transmittals.map((t) => ({
      id: `${t.id}-${t.revisionId}`, revisionId: t.revisionId, revision: { value: t.revision },
      transmittal: {
        id: t.id, number: t.number, direction: t.direction, reasonForIssue: t.reason, dateOfIssue: new Date(t.issuedAt),
        recipients: t.recipients.map((r) => ({ name: r.name, openedAt: r.openedAt ? new Date(r.openedAt) : null })),
      },
    }))),
  ]);
  const deliverable = await getValue("DELIVERABLE_TYPES", doc.deliverableType);
  const label = (rows: { code: string; label: string }[], code: string | null) => (code ? rows.find((r) => r.code === code)?.label ?? code : null);
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const assetLinks = rels.map((r) => ({ rel: r, asset: assetById.get(r.toId) ?? assetById.get(r.fromId) }));

  const canEdit = mayContributeToDocument(user, doc) && !["WITHDRAWN", "CANCELLED"].includes(doc.state);
  const controller = isController(user) || isAdmin(user);

  // A closed document — above the open confidentiality levels — is read by the
  // people named on it. Whoever is answerable for the content names them.
  // Who retires a document and who voids a revision is the project's answer.
  const [withdrawIsControl, voidIsControl] = await Promise.all([
    controlDoes(ctx, "WITHDRAW"),
    controlDoes(ctx, "VOID"),
  ]);
  const mayRetire = controller || (!withdrawIsControl && doc.createdById === user.id);
  // Withdrawn is for a document that was released; cancelled for one that never was.
  // What happened to each revision, with its reason: its own events, and the
  // document's while it was the newest (cancelled, withdrawn, held…).
  const eventsOf = (revId: string) => {
    const index = doc.revisions.findIndex((one) => one.id === revId);
    const from = doc.revisions[index]?.createdAt;
    const until = index > 0 ? doc.revisions[index - 1].createdAt : null;
    return auditEvents.filter((e) => e.entityId === revId
      || (e.entityType === "Document" && from && e.ts >= from && (!until || e.ts < until)));
  };
  const lastReleased = doc.revisions.find((one) => one.state === "RELEASED" || one.state === "SUPERSEDED");
  const everReleased = !!lastReleased;

  const confidentialityRows = await getSet("CONFIDENTIALITY");
  const openCodes = openConfidentiality(confidentialityRows.map((one) => ({ code: one.code, props: one.props })));
  const closed = !!doc.confidentiality && !openCodes.includes(doc.confidentiality);
  const answerableFor = closed
    ? [...new Set([doc.createdByName, ...doc.revisions.flatMap((r) => [r.authoredByName, r.uploadedByName])].filter((one): one is string => !!one))]
    : [];
  const mayNameReaders = closed
    && (isAdmin(user)
      || doc.createdById === user.id
      || doc.revisions.some((r) => r.authoredById === user.id || r.uploadedById === user.id));
  const [namedReaders, projectPeople] = closed
    ? await Promise.all([
        documentReaders(ctx, doc.id),
        projectReaders(ctx),
      ])
    : [[], []] as [{ id: string; userId: string; user: { name: string }; addedByName: string; reason: string | null; createdAt: Date }[], { user: { id: string; name: string }; function: { name: string } | null }[]];
  const inPrep = doc.revisions.find((r) => r.state === "IN_PREPARATION");
  const inReview = doc.revisions.find((r) => r.state === "IN_REVIEW");
  // Decided, waiting for Document Control. Still the revision in hand, and the
  // one the release card is about.
  const notReleased = doc.revisions.find((r) => r.state === "NOT_RELEASED");
  const current = doc.revisions.find((r) => r.state === "RELEASED");
  const working = inPrep ?? inReview ?? notReleased ?? null;
  const shown = current ?? working ?? doc.revisions[0] ?? null;
  const pdf = shown?.files.find((f) => f.kind === "RENDITION") ?? null;
  const native = shown?.files.find((f) => f.kind === "NATIVE") ?? null;
  // Requests on the revision in hand: who asked for it to be sent, to whom, and
  // whether it has gone.
  const carrying = working ?? current ?? null;
  const requests = carrying ? await requestsOn(ctx, carrying.id) : [];
  // The names behind the ids a request holds: the people and organizations of the distribution.
  const named = requests.length ? await requestChoices(ctx, doc) : { proposed: [], others: [], parties: [] };
  const requestNames = {
    people: new Map([...named.proposed, ...named.others].map((one) => [one.id, one.name] as [string, string])),
    parties: new Map(named.parties.map((one) => [one.id, one.name] as [string, string])),
  };
  // Released and never sent to anybody: in use, and nobody told. True whether
  // or not this organization asks for issuing.
  // Released and issued as one act, or as two in order: the project's answer.
  const { policy: projectPolicy } = await import("@/lib/control-activities");
  const together = (await projectPolicy(ctx, "POLICY_RELEASE")) === "TOGETHER";
  // What this organization calls each state; the states themselves are fixed.
  const names = await stateNames(ctx);
  // Why the next revision may be started: asked for by the last verdict, or
  // not — and then whoever starts it says why.
  const ground = doc.isPlaceholder ? { kind: "FIRST" as const } : await revisionGround(ctx, doc.id);
  // A type the organization does not review never goes down a route.
  const reviewed = !(await typeSkipsReview(ctx, doc.docType));
  const sentOut = !!current && transmittalItems.some((item) => item.revisionId === current.id && item.transmittal.direction === "OUTGOING");
  // Where releasing means go ahead, nobody is asked who receives it.
  const policy = await issuePolicy(ctx);
  const mayAsk = carrying ? await mayRequestIssue(ctx, carrying.id, user.id) || controller : false;
  const askChoices = mayAsk && carrying && policy.asked ? await requestChoices(ctx, doc) : null;
  const issueReasons = askChoices ? await getActiveSet("REASONS_FOR_ISSUE") : [];
  const revisionAuthor = carrying ? await authorOf(ctx, carrying.id) : null;

  // What the deciding step answered, and whether that answer is final. A verdict
  // that asks for changes does not release: releasing it would supersede the
  // revision people are working from and replace it with the one just rejected.
  const decidingCycle = working?.cycles.find((one) => one.binding && one.outcome) ?? null;
  const decidedVerdict = decidingCycle?.outcome ?? null;
  const decisionFinal = working ? await decisionLetsItOut(ctx, working.id) : true;
  // The published reasons a route may be rewound. A document that is wrong is
  // replaced by the next revision; only a fault in the route sends it back to a
  // step, and the organization says what counts as one.
  const returnReasons = await getActiveSet("RETURN_REASONS");
  const workingHasPdf = !!working?.files.some((f) => f.kind === "RENDITION");
  const run = working ? await getRunForRevision(ctx, working.id) : null;
  // The steps of its route, for choosing where a revision goes back to.
  const routeSteps = (run?.steps ?? []).map((step, index) => ({ number: index + 1, title: step.title ?? `Step ${index + 1}` }));
  // Sending back, and the hold: who it goes back to is the record's answer —
  // the supplier, or whoever started the route — and who is copied in starts as
  // the people who sat on the route. Only Document Control sees either.
  const { returnRecipients, pendingIssue } = await import("@/lib/issue-requests");
  const held = current?.heldAt ? current : null;
  const sendBackOf = controller ? (working ?? held) : null;
  const [people, backTo, routePeople, heldApproval] = sendBackOf ? await Promise.all([
    recipientCompanies(ctx, { withOffline: false }),
    returnRecipients(ctx, sendBackOf.id),
    Promise.resolve(sendBackOf.cycles.flatMap((cycle) => cycle.assignments.map((seat) => ({ userId: seat.userId })))),
    // Holding a released revision for an outside approval is not in the backend.
    Promise.resolve(null as { status: string; party: { name: string } | null } | null),
  ]) : [[], { ids: [], names: "" }, [], null];
  const heldCleared = held && heldApproval?.status === "CLOSED" ? (await pendingIssue(ctx, held.id, { recipients: false })).ok : false;
  // The document as it was at each point is not kept by the backend.
  const snapshotCount = 0;
  const cycles = doc.revisions.flatMap((rev) => rev.cycles.map((c) => ({ rev, c }))).sort((x, y) => +y.c.submittedAt - +x.c.submittedAt);

  // This revision's own review steps and transmittals, for its progress line.
  const mine = cycles.filter((x) => x.rev.id === (shown?.id ?? ""));

  const own = await ownFields(ctx, "DOCUMENT");
  const revisionPolicy = await formPolicy(ctx, "REVISION");
  const answers = readExtras(doc.extras);

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
    // Whatever this organization asks for itself, read back under its own name.
    ...own.map((field): [string, string | null] => {
      const held = answers[field.key];
      if (!held) return [field.label, null];
      if (field.control === "YES_NO") return [field.label, held === "yes" ? "Yes" : "No"];
      if (field.control === "DATE") return [field.label, fmtDate(new Date(held))];
      const option = field.options?.find((o) => o.code === held);
      return [field.label, option ? option.label : held];
    }),
  ];

  // What the Next step card offers besides the review route itself. Until a
  // revision is released it can be changed — its files and the document's
  // details — in one place. In review it is taken out of the review first:
  // closed as withdrawn, everyone on it told, its comments kept.
  // The document's details, as one set of fields: the revision's edit step and
  // the Details tab both use these, so the two can never ask different things.
  const detailFields = (<>
    <Field label="Title" required><input name="title" defaultValue={doc.title} className={inputCls} /></Field>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
  </>);
  const editing = canEdit && working && working.state === "IN_PREPARATION";
  const lead: StepItem[] = editing ? [{
    key: "edit", label: `Edit rev ${working!.value}`, open: !workingHasPdf, primary: !workingHasPdf, body: (
          <ActionForm action={editRevisionAction} submitLabel="Save" size="sm" hidden={{ revisionId: working!.id, id: doc.id, hasFiles: working!.files.length ? "yes" : "no" }}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="PDF" hint={workingHasPdf ? "replaces the one there" : "what people will read — needed before it is sent"}>
                <input type="file" name="renditionFile" accept=".pdf" className="block w-full text-xs" />
              </Field>
              <Field label="Source file" hint="the editable original; for a schedule or a list, its .xlsx or .csv — read on release">
                <input type="file" name="nativeFile" className="block w-full text-xs" />
              </Field>
            </div>
            {detailFields}
          </ActionForm>
    ),
  }] : canEdit && working && working.state === "IN_REVIEW" ? [{
    key: "withdraw", label: `Withdraw rev ${working.value} from review to edit it`, body: (
          <ActionForm action={withdrawRevisionAction} submitLabel="Withdraw from review" size="sm" variant="secondary" hidden={{ revisionId: working.id }}>
            <Field label="Why" hint="the review closes as withdrawn, its comments kept, and everyone on it is told; send it again once edited" required>
              <input name="reason" required className={inputCls} />
            </Field>
          </ActionForm>
    ),
  }] : [];

  const openCycle = inReview && !run ? [...inReview.cycles].reverse().find((one) => one.status === "OPEN") ?? null : null;
  const extra: StepItem[] = [
      // No separate approval: the review's binding verdict is the decision.
      ...(openCycle ? [{ key: "review", label: `Review of rev ${inReview?.value} — comments and verdict`, href: `/reviews/${openCycle.id}` }] : []),

      // Releasing says the revision is the one in use; issuing says somebody
      // was told. Every ask is here with what came of it, and anybody with
      // standing on the document may add another.
      ...(carrying && policy.asked && carrying.state !== "IN_REVIEW" && (carrying.state !== "NOT_RELEASED" || decisionFinal) ? [
        { key: "send-out", label: carrying.state === "RELEASED" ? `Sending rev ${carrying.value} out` : `Ask for rev ${carrying.value} to be sent`, open: requests.some((one) => one.status === "OPEN") || (!!current && !sentOut), body: (<>
          {requests.length ? (
            <ul className="space-y-2">
              {requests.map((one) => {
                const to = parseRecipients(one.recipients);
                return (
                  <li key={one.id} className="rounded-xl border border-line bg-slate-50 px-3.5 py-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800">{one.reason}</span>
                      <Chip className={one.status === "DONE" ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : "bg-amber-100 text-amber-800 ring-amber-300"}>
                        {one.status === "DONE" ? "sent" : "waiting"}
                      </Chip>
                      <span className="text-slate-400">asked by {one.raisedByName}, {fmtDate(one.raisedAt)}</span>
                    </div>
                    {one.delegated ? (
                      <p className="mt-1.5 text-slate-600">Left to the author to say who it goes to.</p>
                    ) : (
                      <p className="mt-1.5 text-slate-600">
                        {[
                          to.internalUserIds.map((id) => requestNames.people.get(id) ?? id).join(", "),
                          to.partyIds.map((id) => requestNames.parties.get(id) ?? id).join(", "),
                        ].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {one.note ? <p className="mt-1 text-[11px] text-slate-500">{one.note}</p> : null}
                    {one.status === "DONE" && one.transmittal ? (
                      <p className="mt-1.5 text-[11px] text-slate-500">
                        Sent {fmtDate(one.carriedOutAt)} by {one.carriedOutBy} ·{" "}
                        <Link href={`/transmittals/${one.transmittal.id}`} className="font-mono font-semibold text-link hover:underline">{one.transmittal.number}</Link>
                      </p>
                    ) : null}
                    {one.status === "OPEN" && !one.delegated ? (
                      <div className="mt-2 flex flex-wrap gap-2 border-t border-line pt-2">
                        {controller && carrying.state === "RELEASED" ? (
                          <ActionForm action={carryOutRequestAction} submitLabel="Send it" size="sm" hidden={{ requestId: one.id }} />
                        ) : (
                          <p className="text-[11px] text-slate-400">
                            {carrying.state === "RELEASED" ? "Waiting for Document Control to send it." : "It goes out when the revision is released."}
                          </p>
                        )}
                        {one.raisedById === user.id || controller ? (
                          <ActionForm action={cancelRequestAction} submitLabel="Withdraw" variant="danger" size="sm" hidden={{ requestId: one.id }} />
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">
              {current && !sentOut
                ? "Nobody has asked for this revision to be sent. It is released and in use; no one has been told."
                : "No request yet."}
            </p>
          )}

          {askChoices ? (
            <details className="mt-3 border-t border-line pt-3">
              <summary className="cursor-pointer text-xs font-semibold text-link">Ask for it to be sent</summary>
              <div className="mt-2">
                <ActionForm action={requestIssueAction} submitLabel="Ask" size="sm" hidden={{ revisionId: carrying.id }}>
                  <RequestIssue
                    author={revisionAuthor}
                    reasons={issueReasons.map((one) => ({ code: one.code, label: one.label }))}
                    proposed={askChoices.proposed}
                    others={askChoices.others}
                    parties={askChoices.parties}
                    ours={askChoices.ours}
                  />
                </ActionForm>
              </div>
            </details>
          ) : null}
        </>) },
      ] : []),

      ...(controller && held && !held.heldReason?.startsWith("Not approved") ? [
        { key: "hold", label: `Rev ${held.value} is on hold`, open: true, body: (<>
          {heldApproval?.status !== "CLOSED" ? (
            <p className="text-xs text-slate-500">Waiting for {heldApproval?.party?.name ?? "the outside party"} to answer. It stays not for use until then.</p>
          ) : heldCleared ? (
            <>
              <p className="mb-3 text-xs text-slate-600">{heldApproval.party?.name ?? "The outside party"} approved it. Lifting the hold puts it back in use and sends whatever was asked for it.</p>
              <ActionForm action={liftHoldAction} submitLabel="Lift the hold" size="sm" hidden={{ revisionId: held.id }} />
            </>
          ) : (
            <>
              <p className="mb-3 text-xs text-slate-600">{heldApproval.party?.name ?? "The outside party"} did not approve it. Sending it back keeps it on hold, not for use, for good; the next revision replaces it.</p>
              <ActionForm action={returnHeldAction} submitLabel="Send it back" size="sm" variant="danger" hidden={{ revisionId: held.id }}>
                <Field label="Why it is going back" required hint="whoever gets it reads this">
                  <textarea name="reason" rows={2} required className={inputCls} />
                </Field>
                <CopyPicker companies={people} backTo={backTo.names} preselected={[...new Set(routePeople.map((one) => one.userId))]} />
              </ActionForm>
            </>
          )}
        </>) },
      ] : []),

      ...(controller && working ? [
        { key: "release", primary: decisionFinal && working.state === "NOT_RELEASED", label: decisionFinal ? `Release rev ${working.value}` : `Send rev ${working.value} back`, open: run?.status === "DONE" || working.approvals.some((a) => !a.withdrawnAt), body: (<>
          {decisionFinal ? <PreflightPanel result={await preflight("RELEASE", { revisionId: working.id }, ctx)} className="mb-3" /> : null}
          {/* What was asked for is read on its own card; releasing carries out
              every request waiting, and asks nobody's permission to publish. */}
          {requests.some((one) => one.status === "OPEN" && !one.delegated) ? (
            <p className="mb-3 text-xs text-slate-500">
              Releasing also sends {requests.filter((one) => one.status === "OPEN" && !one.delegated).length} request{requests.filter((one) => one.status === "OPEN" && !one.delegated).length === 1 ? "" : "s"} that {requests.filter((one) => one.status === "OPEN" && !one.delegated).length === 1 ? "is" : "are"} waiting.
            </p>
          ) : null}
          {working.statusCode || !decisionFinal ? (
            <>
              {/* A final verdict releases. One that asks for changes does not:
                  releasing it would supersede the revision people are working
                  from, and replace it with the one just rejected. It goes back
                  to a step of its route, or to its author. */}
              <p className={`mb-3 rounded-xl px-3.5 py-2.5 text-xs ${decisionFinal ? "bg-tint text-brand-ink" : "bg-orange-50 text-orange-900 ring-1 ring-orange-200"}`}>
                The route settled on <strong>{working.statusCode} — {label(statuses, working.statusCode)}</strong>
                {decidedVerdict ? <> with <strong>{decidedVerdict}</strong></> : null}.
                {decisionFinal
                  ? " Releasing puts that status in force. You do not choose it."
                  : " That verdict asks for changes, so this revision is not released: releasing it would replace the revision people are working from. Send it back."}
              </p>
              {decisionFinal ? (
                <ActionForm action={releaseRevisionAction} submitLabel={`Release as ${working.statusCode}`} size="sm" hidden={{ revisionId: working.id, statusCode: working.statusCode ?? "" }} />
              ) : null}
              <details className="mt-3 border-t border-line pt-3" open={!decisionFinal}>
                <summary className="cursor-pointer text-xs font-semibold text-slate-600">{decisionFinal ? "Send it back instead" : "Send it back"}</summary>
                <div className="mt-2">
                  <ActionForm action={returnAtGateAction} submitLabel="Send it back" size="sm" hidden={{ revisionId: working.id }}>
                    <ReturnTarget steps={routeSteps} reasons={returnReasons.map((one) => ({ code: one.code, label: one.label, meaning: typeof one.props.meaning === "string" ? one.props.meaning : null }))} />
                    <CopyPicker companies={people} backTo={`${backTo.names} — when it goes back to its author`} preselected={[...new Set(routePeople.map((one) => one.userId))]} />
                  </ActionForm>
                </div>
              </details>
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
        </>) },
      ] : []),

      ...(canEdit && !working && doc.kind !== "RECORD" ? [
        { key: "revise", primary: ground.kind !== "OWN", label: ground.kind === "FIRST" ? "Start the first revision" : ground.kind === "ASKED" ? `New revision — answer rev ${doc.revisions[0]?.value}` : "Start a new revision", open: !doc.revisions.length, body: (<>
          <ActionForm action={prepareRevisionAction} submitLabel="Start revision" hidden={{ documentId: doc.id }}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* What it is issued for, from the organization's statuses: proposed now, confirmed or changed by the approver. */}
              <Field label="Issued for" required hint="the approver confirms it or changes it in the verdict" className="sm:col-span-2">
                <select name="purpose" required defaultValue="" className={inputCls}>
                  <option value="" disabled>Choose…</option>
                  {statuses.filter((one) => one.status === "ACTIVE").map((one) => <option key={one.code} value={one.code}>{one.code} — {one.label}</option>)}
                </select>
              </Field>
              {ground.kind === "FIRST" ? (
                <input type="hidden" name="reasonForRevision" value="First issue" />
              ) : ground.kind === "ASKED" ? (
                // The verdict is the reason; nobody writes it again.
                <div className="rounded-lg bg-tint-soft px-3 py-2 text-xs text-slate-700 sm:col-span-2">
                  <span className="stencil mr-2 text-slate-500">Why</span>{ground.why}
                  {ground.comments ? <span className="text-slate-500"> · {ground.comments} comment{ground.comments === 1 ? "" : "s"} to address</span> : null}
                </div>
              ) : null}
              <Asked policy={revisionPolicy} field="changeDescription" className="sm:col-span-2">
                {({ required }) => <input name="changeDescription" required={required} className={inputCls} defaultValue={doc.revisions.length ? "" : "Initial version"} />}
              </Asked>
              <Asked policy={revisionPolicy} field="plannedSubmissionDate">
                {({ required }) => <input type="date" name="plannedSubmissionDate" required={required} className={inputCls} />}
              </Asked>
              <Asked policy={revisionPolicy} field="phase">
                {({ required }) => (
                  <select name="phase" required={required} className={inputCls} defaultValue="">
                    <option value="" disabled={required}>—</option>
                    {phases.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
                  </select>
                )}
              </Asked>
              <Added fields={revisionPolicy.own} className="sm:col-span-2" />
              <Field label="PDF" hint="optional now — what people will read; needed before it is sent"><input type="file" name="renditionFile" accept=".pdf" className="block w-full text-xs" /></Field>
              <Field label="Native file" hint="optional — the editable original (.docx, .dwg, .xlsx…)"><input type="file" name="nativeFile" className="block w-full text-xs" /></Field>
            </div>
          </ActionForm>
        </>) },
      ] : []),
  ];

  // Released, then held for an outside approval: on hold is what it is now.
  const onHold = shown?.state === "RELEASED" && !!shown.heldAt;
  const stateLabel = shown
    ? stateName(names, shown.state, { together, held: onHold })
    : DOC_STATE_LABEL[doc.state as DocState] ?? doc.state;
  const stateColor = onHold ? "bg-red-50 text-red-800 ring-red-200" : shown ? revStateColor(shown.state) : DOC_STATE_COLOR[doc.state as DocState] ?? "";

  return (
    <div className="space-y-4">
      {doc.legalHold ? (
        <Banner tone="warn" title={`On legal hold${doc.legalHoldAt ? ` since ${fmtDate(doc.legalHoldAt)}` : ""}${doc.legalHoldBy ? ` — ${doc.legalHoldBy}` : ""}`}>
          {doc.legalHoldReason ?? "No reason was recorded."} While held it cannot be retired and no revision voided. New revisions and reviews go on.
        </Banner>
      ) : null}
      {sp.released ? (
        <Banner tone="good" title={`Released${sp.superseded ? ` · rev ${sp.superseded} superseded` : ""}`}>
          This revision is now the one in use.{sp.issued && sp.issued !== "0" ? ` It was issued as the decision asked: ${sp.issued} transmittal${sp.issued === "1" ? "" : "s"} raised.` : " Nobody has been told yet."}
        </Banner>
      ) : null}

      {/* What is it: the plate a transmittal carries — number and title as
          one name, then the facts of the revision in hand, then what it is
          classified as. The way back and the files sit to the right. */}
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col-reverse gap-3 px-5 pt-6 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
              {doc.docNumber}
              {doc.state === "CANCELLED" ? <span className="stamp font-sans text-slate-500">cancelled</span> : null}
              {doc.state === "WITHDRAWN" ? <span className="stamp font-sans text-red-700">withdrawn</span> : null}
              {doc.state === "ARCHIVED" ? <span className="stamp font-sans text-slate-500">archived</span> : null}
              {doc.revisions[0]?.state === "VOID" ? <span className="stamp font-sans text-red-700">rev {doc.revisions[0].value} void</span> : null}
              {doc.legalHold ? <span className="stamp font-sans text-amber-800">legal hold</span> : null}
            </p>
            <h1 className="plate-name mt-1 min-w-0">{doc.title}</h1>
            <p className="plate-meta mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              {shown ? <span className="font-mono font-semibold text-slate-800">Rev {shown.value}</span> : null}
              <StateChip label={stateLabel} color={stateColor} />
              {current?.heldAt ? <span className="stamp font-sans text-red-700">not for use</span> : null}
              {shown?.statusCode ? <span>&middot; {shown.statusCode} — {label(statuses, shown.statusCode)}</span> : null}
              {/* The plate is about the revision in use; this says what the one
                  after it is doing, in the register's words. */}
              {current && working ? <span className="text-amber-700">&middot; rev {working.value} {stateName(names, working.state).toLowerCase()}</span> : null}
            </p>
            <p className="mt-1 max-w-3xl text-[11.5px] leading-4 text-slate-400">
              {[
                label(types, doc.docType),
                label(disciplines, doc.discipline),
                doc.originator ? `from ${label(suppliers, doc.originator)}` : `by ${doc.createdByName}`,
                doc.contractRef ? `order ${doc.contractRef}` : null,
                label(criticalities, doc.criticality),
                label(confidentialities, doc.confidentiality),
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
            <Link href="/documents" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Documents</Link>
            {pdf ? <a href={`/api/files/${pdf.id}`} target="_blank" className="ask inline-flex items-center gap-1.5"><ExternalLink className="h-3.5 w-3.5" /> Open PDF</a> : null}
            {native ? <a href={`/api/files/${native.id}?dl=1`} className="ask inline-flex items-center gap-1.5"><Download className="h-3.5 w-3.5" /> Source file</a> : null}
            {current && !current.heldAt ? <Link href={`/transmittals/new?doc=${doc.id}`} className="ask inline-flex items-center gap-1.5"><Send className="h-3.5 w-3.5" /> Issue</Link> : null}
          </div>
        </div>
      </section>

      {current?.heldAt ? (
        <Banner tone="danger" title={`Rev ${current.value} is on hold — not for use`}>
          {current.heldReason} Since {fmtDate(current.heldAt)}{current.heldByName ? `, by ${current.heldByName}` : ""}. It stays released, but nobody may work from it until the hold is lifted.
        </Banner>
      ) : null}

      {/* Where is it — always in view */}
      <section id="workflow" className="scroll-mt-28">
        {/* A supplier sees its own delivery: attach, then send. */}
        {!user.isInternal && user.partyCode && doc.originator === user.partyCode
          ? <SupplierDelivery documentId={doc.id} />
          : <WorkflowPanel doc={doc} user={user} lead={lead} extra={extra} />}
      </section>

      {/* Everything else, one tab at a time */}
      <DocTabs
        tabs={[
          {
            id: "viewer",
            label: "Preview",
            content: pdf ? (
              <iframe src={`/api/files/${pdf.id}`} title={`${doc.docNumber} rev ${shown?.value ?? ""}`} className="h-[70vh] min-h-120 w-full bg-slate-100" />
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
                    <div key={k} className="flex items-start justify-between gap-4 border-b border-line py-2">
                      <dt className="text-xs text-slate-500">{k}</dt>
                      <dd className="text-right text-xs font-semibold text-slate-800">{v}</dd>
                    </div>
                  ))}
                </dl>
                {closed ? (
                  <ReadersPanel
                    documentId={doc.id}
                    confidentiality={label(confidentialities, doc.confidentiality) ?? doc.confidentiality ?? "closed"}
                    readers={namedReaders.map((row) => ({ id: row.id, name: row.user.name, addedByName: row.addedByName, reason: row.reason, at: row.createdAt }))}
                    candidates={projectPeople
                      .filter((one) => !namedReaders.some((row) => row.userId === one.user.id) && one.user.id !== doc.createdById)
                      .map((one) => ({ id: one.user.id, name: one.user.name, functionName: one.function?.name ?? null }))}
                    mayName={mayNameReaders}
                    answerable={answerableFor}
                  />
                ) : null}
                {editing ? (
                  // One place to change a revision being prepared: its edit step, files and details together.
                  <p className="mt-4 text-xs text-slate-500">Rev {working!.value} is being prepared: change these details with its files in{" "}<a href="#step-edit" className="font-semibold text-link underline">Edit rev {working!.value}</a>.</p>
                ) : canEdit && (doc.revisions.length === 0 || doc.kind === "RECORD") ? (
                  // Nothing prepared yet (a reserved number), or a record, which has no review: set here.
                  <details className="mt-4">
                    <summary className="cursor-pointer list-none text-xs font-semibold text-link">Edit details</summary>
                    <div className="mt-3 max-w-2xl">
                      <ActionForm action={updateDocumentAction} submitLabel="Save" size="sm" hidden={{ id: doc.id }}>
                        {detailFields}
                      </ActionForm>
                    </div>
                  </details>
                ) : canEdit && doc.kind !== "RECORD" ? (
                  <p className="mt-4 text-xs text-slate-500">To change these details, start a new revision: they change with it.</p>
                ) : null}
                {/* Two different intentions, kept apart: hold keeps it as it is; ending it says it is finished. */}
                {controller ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer list-none text-xs font-semibold text-slate-500">{doc.legalHold ? "Lift the legal hold…" : "Put on legal hold…"}</summary>
                    <div className="mt-3 max-w-md">
                      <ActionForm action={setLegalHoldAction} submitLabel={doc.legalHold ? "Lift legal hold" : "Put on legal hold"} size="sm" variant="secondary" hidden={{ documentId: doc.id, hold: doc.legalHold ? "off" : "on" }}>
                        <Field label={doc.legalHold ? "Why it is lifted" : "Why it is held"} required hint={doc.legalHold ? "kept in the activity log" : "while held it cannot be ended and no revision voided; work on it goes on"}>
                          <input name="reason" required className={inputCls} placeholder={doc.legalHold ? "e.g. Claim settled" : "e.g. Claim 42 from the contractor"} />
                        </Field>
                      </ActionForm>
                    </div>
                  </details>
                ) : null}
                {/* Cancel or withdraw: both are listed, with what is possible and why
                    not; once ended, the same place takes it back. */}
                {mayRetire && doc.kind !== "RECORD" ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer list-none text-xs font-semibold text-slate-500">
                      {doc.state === "CANCELLED" ? "Take the cancellation back…" : doc.state === "WITHDRAWN" ? "Take the withdrawal back…" : "Cancel or withdraw…"}
                    </summary>
                    <div className="mt-3 max-w-md space-y-4">
                      {doc.state === "CANCELLED" || doc.state === "WITHDRAWN" ? (
                        <ActionForm action={reinstateDocumentAction} submitLabel="Reinstate" size="sm" variant="secondary" hidden={{ documentId: doc.id }}>
                          <p className="text-xs text-slate-600">
                            It is {doc.state === "CANCELLED" ? "cancelled" : "withdrawn"}. Reinstated, it is in use again{doc.state === "WITHDRAWN" ? ", and everyone who was told to stop using it is told it counts again" : ""}.
                          </p>
                          <Field label="Why" required><input name="reason" required className={inputCls} placeholder="e.g. Brought back into scope by variation 14" /></Field>
                        </ActionForm>
                      ) : doc.state === "ARCHIVED" ? (
                        <p className="text-xs text-slate-500">It is archived with its project. Reopen the project to bring it back.</p>
                      ) : doc.legalHold ? (
                        <p className="text-xs text-slate-500">It is on legal hold: neither is possible until the hold is lifted.</p>
                      ) : working ? (
                        <p className="text-xs text-slate-500">Rev {working.value} is {stateName(names, working.state, { together }).toLowerCase()}: finish it, or withdraw it from review, before the document is cancelled or withdrawn.</p>
                      ) : (
                        <>
                          <div>
                            <p className="text-xs font-semibold text-slate-800">Cancel</p>
                            {everReleased ? (
                              <p className="mt-1 text-xs text-slate-500">Not possible: rev {lastReleased?.value} was released. A released document is withdrawn instead.</p>
                            ) : (
                              <ActionForm action={endDocumentStateAction} submitLabel="Cancel the document" variant="danger" size="sm" hidden={{ documentId: doc.id, kind: "CANCELLED" }}>
                                <p className="text-xs text-slate-600">It will never be produced. Its number stays reserved to it, and it can be reinstated.</p>
                                <Field label="Why" required><input name="reason" required className={inputCls} placeholder="e.g. Dropped from the scope by variation 12" /></Field>
                              </ActionForm>
                            )}
                          </div>
                          <div className="border-t border-line pt-3">
                            <p className="text-xs font-semibold text-slate-800">Withdraw</p>
                            {everReleased ? (
                              <ActionForm action={endDocumentStateAction} submitLabel="Withdraw the document" variant="danger" size="sm" hidden={{ documentId: doc.id, kind: "WITHDRAWN" }} confirmText="Everyone who was sent a revision of it will be told to stop using it. Continue?">
                                <p className="text-xs text-slate-600">It was released and is no longer valid. It stays in the register with its history; everyone who was sent a revision of it is told to stop using it. It can be reinstated.</p>
                                <Field label="Why" required><input name="reason" required className={inputCls} placeholder="e.g. Made obsolete by the design change of variation 12" /></Field>
                              </ActionForm>
                            ) : (
                              <p className="mt-1 text-xs text-slate-500">Not possible: nothing of it was ever released. A document never released is cancelled instead.</p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </details>
                ) : null}
              </div>
            ),
          },
          {
            id: "life",
            label: "Life of this revision",
            content: shown ? (
              <div className="px-5 py-4">
                <Timeline
                  points={[
                    {
                      label: `Rev ${shown.value} established`,
                      at: shown.createdAt,
                      // Who answers for the content, and who placed the file: two
                      // different people in most organizations.
                      holder: shown.authoredByName ?? shown.authorizedByName ?? doc.createdByName,
                      detail: [
                        shown.reasonForRevision,
                        shown.uploadedByName && shown.uploadedByName !== (shown.authoredByName ?? "") ? `Filed by ${shown.uploadedByName}` : null,
                      ].filter(Boolean).join(" · ") || null,
                    },
                    { label: "Sent for review", at: mine.map((x) => x.c.submittedAt).sort((a, b) => a.getTime() - b.getTime())[0] ?? null, holder: mine.length ? `${mine.length} step${mine.length === 1 ? "" : "s"}` : null },
                    {
                      label: "Decided",
                      at: mine.filter((x) => x.c.binding).map((x) => x.c.outcomeAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null,
                      holder: mine.find((x) => x.c.binding && x.c.outcome)?.c.outcomeByName ?? null,
                      detail: shown.statusCode && !shown.releasedAt ? `${shown.statusCode}, not released` : null,
                    },
                    { label: shown.statusCode ? `Released at ${shown.statusCode}` : "Released", at: shown.releasedAt, holder: shown.releasedByName ?? null },
                    { label: "Issued to somebody", at: transmittalItems.filter((i) => i.revisionId === shown.id).map((i) => i.transmittal.dateOfIssue).sort((a, b) => a.getTime() - b.getTime())[0] ?? null, holder: transmittalItems.filter((i) => i.revisionId === shown.id).length ? `${transmittalItems.filter((i) => i.revisionId === shown.id).length} transmittal(s)` : null },
                    { label: "Replaced by a newer revision", at: shown.state === "SUPERSEDED" ? shown.supersededAt ?? null : null, skipped: shown.state === "RELEASED" },
                  ]}
                />
              </div>
            ) : <Empty>No revision yet.</Empty>,
          },
          {
            id: "revisions",
            label: "Revisions",
            count: doc.revisions.length,
            content: doc.revisions.length ? (
              <ul className="divide-y divide-line">
                {doc.revisions.map((rev, index) => (
                  /* Only the newest revision can still be acted on. Everything
                     before it is frozen as it was issued. */
                  <RevisionRow key={rev.id} rev={rev} latest={index === 0} followedBy={index > 0 ? { value: doc.revisions[index - 1].value, why: doc.revisions[index - 1].reasonForRevision } : null} statusLabel={label(statuses, rev.statusCode)} stateLabel={stateName(names, rev.state, { together, held: !!rev.heldAt })} controller={controller} userId={user.id} userRole={user.role} voidIsControl={voidIsControl} held={doc.legalHold} events={eventsOf(rev.id)} />
                ))}
              </ul>
            ) : <Empty>No revision yet.</Empty>,
          },
          {
            id: "reviews",
            label: "Reviews",
            count: cycles.length,
            content: cycles.length ? (
              <ul className="divide-y divide-line">
                {cycles.map(({ rev, c }) => (
                  <li key={c.id}>
                    <Link href={`/reviews/${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-slate-50">
                      <span className="font-mono text-xs font-bold text-slate-900">Rev {rev.value}</span>
                      <span className="text-xs text-slate-500">review {c.sequence}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                        {c.status === "OPEN" ? `with ${c.assignments.map((a) => a.userName).join(", ") || "nobody yet"}` : c.withdrawn ? `withdrawn${c.outcomeNote ? ` — ${c.outcomeNote.replace(/^Withdrawn for update by /, "by ")}` : ""}` : prettyState(c.outcome ?? "closed")}
                      </span>
                      {c.comments.length ? <span className="text-[11px] text-slate-500">{c.comments.length} comment{c.comments.length === 1 ? "" : "s"}</span> : null}
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
                  <ul className="divide-y divide-line">
                    {transmittalItems.map((item) => {
                      const t = item.transmittal;
                      const seen = t.recipients.filter((r) => r.openedAt).length;
                      return (
                        <li key={item.id}>
                          <Link href={`/transmittals/${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-slate-50">
                            <span className="font-mono text-xs font-bold text-link">{t.number}</span>
                            <span className="text-xs text-slate-500">rev {item.revision.value} · {prettyState(t.reasonForIssue)} · {fmtDate(t.dateOfIssue)}</span>
                            <span className="min-w-0 flex-1 truncate text-xs text-slate-700">{t.recipients.map((r) => r.name).join(", ") || "—"}</span>
                            <span className={`text-[11px] font-semibold ${seen === t.recipients.length && seen ? "text-emerald-700" : "text-slate-500"}`}>{seen}/{t.recipients.length} have seen it</span>
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
                  <ul className="divide-y divide-line">
                    {doc.baselineEntries.map((e) => (
                      <UsedIn key={e.id} kind="Schedule action" href={`/actions/${e.action.code}`} code={e.action.code} text={`${e.action.name} — needs ${e.requiredStatus} by ${fmtDate(e.requiredBy)}`} />
                    ))}
                    {doc.packageMembers.map((m) => (
                      <UsedIn key={m.id} kind="Package" href={`/packages/${m.package.identifier}`} code={m.package.identifier} text={`${m.package.title ?? m.package.recipientName} — needs ${m.requiredStatus.split(",").join(" or ")}`} />
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
                  <details className="border-t border-line py-3">
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
                  <ul className="divide-y divide-line px-5">
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
                {snapshotCount ? <Link href={`/documents/${doc.id}/history`} className="block border-t border-line px-5 py-3 text-xs font-semibold text-link hover:underline">See the document as it was at each recorded point →</Link> : null}
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

type RevData = LegacyRevision;

/** One line per revision; its record and its per-revision controls open in place. */
function RevisionRow({ rev, latest, followedBy, statusLabel, stateLabel, controller, userId, userRole, voidIsControl, held = false, events = [] }: { rev: RevData; latest: boolean; followedBy: { value: string; why: string | null } | null; statusLabel: string | null; stateLabel: string; controller: boolean; userId: string; userRole: string; voidIsControl: boolean; held?: boolean; events?: { id: string; actorName: string; action: string; detail: string | null; ts: Date }[] }) {
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
          <StateChip label={stateLabel} color={REV_STATE_COLOR[state] ?? ""} />
          {rev.statusCode ? <span className="text-xs text-slate-500">{rev.statusCode} · {statusLabel}</span> : null}
          <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{rev.changeDescription ?? ""}</span>
          <span className="text-[11px] text-slate-400">{fmtDate(rev.releasedAt ?? rev.createdAt)}</span>
          {/* Why the next one exists, kept with this one: read where it is
              asked, without opening the next revision. */}
          {followedBy?.why ? (
            <span className="basis-full pl-6 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-600">Rev {followedBy.value} followed</span> — {followedBy.why}
            </span>
          ) : null}
        </summary>
        <div className="space-y-3 bg-slate-50/60 px-5 py-4 pl-11">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {facts.filter(([, v]) => v).map(([k, v]) => (
              <div key={k}><dt className="text-[11px] text-slate-400">{k}</dt><dd className="text-xs text-slate-800">{v}</dd></div>
            ))}
          </dl>

          {/* What happened to this revision, each with who, when and why. */}
          {events.length ? (
            <div>
              <p className="text-[11px] text-slate-400">What happened to it</p>
              <ul className="mt-1 space-y-1">
                {[...events].reverse().map((e) => (
                  <li key={e.id} className="text-xs text-slate-700">
                    <span className="text-slate-400">{fmtDate(e.ts)}</span> · <span className="font-semibold">{prettyState(e.action)}</span> · {e.actorName}
                    {e.detail ? <span className="block pl-3 text-slate-500">{plain(e.detail)}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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

          {approval && !approval.withdrawnAt && latest && controller ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-red-700">Withdraw this approval…</summary>
              <div className="mt-2 max-w-md">
                <ActionForm action={withdrawApprovalAction} submitLabel="Withdraw approval" variant="danger" size="sm" hidden={{ revisionId: rev.id }}>
                  <input name="reason" required className={inputCls} placeholder="Why, and who asked for it" />
                </ActionForm>
              </div>
            </details>
          ) : null}

          {/* Voiding is for the newest revision only: a revision already
              replaced is frozen as it was issued, and voiding it would change
              nothing anybody works from.

              Two occasions. One that was released in error, which somebody may
              already have worked from. And one that was never reviewed at all —
              opened, left, and now in the way of the next one: voiding it says
              it never counted, which is the truth, and clears the document. */}
          {/* A void taken back, with a reason: only the newest revision, not while held. */}
          {!held && controller && latest && state === "VOID" ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">Take the void back…</summary>
              <div className="mt-2 max-w-md">
                <ActionForm action={unvoidRevisionAction} submitLabel="Take the void back" size="sm" variant="secondary" hidden={{ revisionId: rev.id }}>
                  <p className="text-xs text-slate-600">Rev {rev.value} counts again, as {rev.releasedAt ? "released" : "in preparation"}. Everyone who received it is told.</p>
                  <Field label="Why" required><input name="reason" required className={inputCls} placeholder="e.g. Voided against the wrong revision" /></Field>
                </ActionForm>
              </div>
            </details>
          ) : null}
          {!held && (controller || (!voidIsControl && (rev.authoredById === userId || rev.uploadedById === userId))) && latest && (state === "RELEASED" || (state === "IN_PREPARATION" && !rev.cycles.length)) ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-red-700">{state === "RELEASED" ? "Void — issued in error…" : "Void — it was never reviewed…"}</summary>
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
