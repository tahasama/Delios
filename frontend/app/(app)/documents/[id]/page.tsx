import { Select } from "@/components/select";
import { plannedState, plannedProgress } from "@/lib/actions/planned-state";
import { OwnFields } from "@/app/(app)/documents/new/own-fields";
import { DEFAULT_RISK_DAYS } from "@/lib/actions/action-state";
import { ReadersPanel } from "./readers-panel";
import { documentAssets, projectAssets } from "@/lib/records/api";
import { documentReaders, projectReaders } from "@/lib/documents/api-readers";
import { controlDoes, policy as controlPolicy } from "@/lib/settings/control-activities";
import { notFound } from "next/navigation";
import { requireScope } from "@/lib/core/scope";
import { preflight } from "@/lib/conformance/rules/preflight";
import { PreflightPanel } from "@/components/preflight";
import Link from "next/link";
import { isController, isAdmin, mayContributeToDocument, standsInForControl } from "@/lib/core/auth";
import { ToneChip, StateChip, Banner, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { Asked, Added } from "@/components/policy-fields";
import { DOC_STATE_COLOR, revStateColor, type DocState } from "@/lib/core/standard";
import { stateNames, stateName, supplierStage, supplierStageName, docStateName, supplierStamp } from "@/lib/core/state-names";
import { revisionGround } from "@/lib/documents/revision-ground";
import { ownFields, readExtras, formPolicy } from "@/lib/settings/field-policy";
import { fmtDate, timeAgo, plain } from "@/lib/core/utils";
import { readableDetail } from "@/lib/settings/activity-words";
import { forType } from "@/lib/settings/serving";
import { readersOn } from "@/lib/settings/viewers";
import { cookies } from "next/headers";
import { PREF } from "@/lib/core/preferences";
import { servingOf } from "@/lib/settings/serving-api";
import { getActiveSet, getSet, getValue } from "@/lib/settings/config";
import { updateDocumentAction, reinstateDocumentAction, linkAssetAction, unlinkRelationshipAction, endDocumentStateAction } from "@/lib/documents/forms";
import {
  prepareRevisionAction, editRevisionAction, withdrawRevisionAction, releaseRevisionAction, returnAtGateAction, liftHoldAction, returnHeldAction,
} from "@/lib/documents/forms-revisions";
import { parseRecipients, mayRequestIssue, requestChoices, issuePolicy, decisionLetsItOut, requestsOn } from "@/lib/transmittals/issue-requests";
import { documentPage, documentContext, handBacks } from "@/lib/documents/api";
import { requestIssueAction, carryOutRequestAction, cancelRequestAction } from "@/lib/transmittals/forms-issue-requests";
import { RequestIssue } from "./request-issue";
import { ReleaseRecipients } from "./release-recipients";
import { ReturnTarget } from "./return-target";
import { CopyPicker } from "@/app/(app)/transmittals/new/recipient-picker";
import { recipientCompanies } from "@/lib/transmittals/recipients";
import { setLegalHoldAction } from "@/lib/documents/forms-hold";
import { getRunForRevision } from "@/lib/reviews/workflow";
import { WorkflowPanel } from "./workflow-panel";
import type { StepItem } from "./next-step";
import { SupplierDelivery } from "./supplier-delivery";
import { Timeline } from "@/components/timeline";
import { openCopy } from "@/lib/documents/copies";
import { StampPending } from "@/components/stamp-pending";
import { FilesChecking } from "@/components/files-checking";
import { checking } from "@/lib/documents/checking";
import { FilePreview } from "@/components/file-preview";
import { DocTabs } from "./doc-tabs";
import { ArrowLeft, Download, ExternalLink, FileText, Send, X, FileDown } from "lucide-react";
import { activityList, scheduleSource } from "@/lib/actions/api";
import { addDocumentToActionAction } from "@/lib/actions/forms-links";
import { sendToSupplierAction, askBackAction, answerAskAction } from "@/lib/packages/forms-supplier";
import { addressees } from "@/lib/transmittals/api";
import { AlsoKnownAs, type Equivalent } from "./numbers";
import { AsReceivedWarning } from "@/components/as-received-warning";
import { api, projectPath } from "@/lib/client";

export const dynamic = "force-dynamic";

/**
 * One document, one screen, three questions in reading order:
 *   what is it (header + details), where is it (next step), what happened (revisions, issues, history).
 * Every fact appears once. Actions live in the Next step card, or on the
 * revision they apply to — never in two places.
 */
import { Empty, UsedIn, prettyState, RevisionRow } from "./revision-row";

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

  const doc = await documentPage(ctx, id);
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
        id: t.id, number: t.number, direction: t.direction, reasonForIssue: t.reason, dateOfIssue: new Date(t.issuedAt), mayOpen: t.mayOpen,
        recipients: t.recipients.map((r) => ({ name: r.name, openedAt: r.openedAt ? new Date(r.openedAt) : null })),
      },
    }))),
  ]);
  const deliverable = await getValue("DELIVERABLE_TYPES", doc.deliverableType);
  const label = (rows: { code: string; label: string }[], code: string | null) => (code ? rows.find((r) => r.code === code)?.label ?? code : null);
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const assetLinks = rels.map((r) => ({ rel: r, asset: assetById.get(r.toId) ?? assetById.get(r.fromId) }));

  const canEdit = mayContributeToDocument(user, doc) && !["WITHDRAWN", "CANCELLED"].includes(doc.state);
  // Asked of a supplier (a placeholder went out to them): its files and what it is issued for are theirs from then
  // on. Nobody of ours starts a revision or changes its files; the backend refuses it too (ASKED_OF_SUPPLIER).
  // The control function may take it back (unlock it) to change anything, until it sends it to them again.
  const supplierName = doc.originator && context.transmittals.some((t) => t.direction === "OUTGOING" && t.itemKind === "PLACEHOLDER")
    ? (await addressees(ctx).catch(() => ({ parties: [] as { code: string; name: string }[] }))).parties.find((p) => p.code === doc.originator)?.name ?? null
    : null;
  // One side holds it at a time, and only the holder changes it; the other asks for it back, and the holder accepts.
  const withSupplier = supplierName ? doc.withSupplier ?? null : null;
  const askedOf = user.isInternal && supplierName && withSupplier === true ? supplierName : null;
  const asks = supplierName ? await handBacks(ctx, doc.id) : [];
  const openAsk = asks.find((one) => !one.answeredAt) ?? null;
  const controller = isController(user) || isAdmin(user);
  // Equivalence: its numbers with other organizations, ours only; kept by the control function (or, with none, whoever exchanges).
  const numbers = user.isInternal
    ? await api<Equivalent[]>(projectPath(ctx, `/documents/${doc.id}/numbers`)).catch(() => [] as Equivalent[]) : [];
  const mayKeepNumbers = user.isInternal && (controller || standsInForControl(user));
  // The control function adds it to a schedule action from here too: the actions with a discipline tagged that do not need it yet.
  const mayAddToAction = ctx.can("CONTROL") && !["WITHDRAWN", "CANCELLED"].includes(doc.state);
  const actionChoices = mayAddToAction
    // Only actions that concern the document's own discipline: it is needed for that discipline, never another.
    ? (await activityList(ctx)).filter((a) => a.departments.includes(doc.discipline) && !doc.baselineEntries.some((e) => e.action.code === a.code))
    : [];

  // A document above some function's clearance is read by those people only if named on it. Whoever is answerable
  // for the content names them.
  // Who retires a document and who voids a revision is the project's answer.
  const [withdrawIsControl, voidIsControl] = await Promise.all([
    controlDoes(ctx, "WITHDRAW"),
    controlDoes(ctx, "VOID"),
  ]);
  const mayRetire = controller || (!withdrawIsControl && doc.createdById === user.id);
  // Withdrawn is for a document that was released; cancelled for one that never was.
  const lastReleased = doc.revisions.find((one) => one.state === "RELEASED" || one.state === "SUPERSEDED");
  const everReleased = !!lastReleased;

  // Clearance is the one confidentiality rule (owner): above some function's clearance on the project, its people read
  // the document only if named on it, so who is named is shown, and may be changed.
  const closed = doc.aboveSomeClearance;
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
  // Decided, waiting for the control function. Still the revision in hand, and the
  // one the release card is about.
  const notReleased = doc.revisions.find((r) => r.state === "NOT_RELEASED");
  const current = doc.revisions.find((r) => r.state === "RELEASED");
  const working = inPrep ?? inReview ?? notReleased ?? null;
  const shown = current ?? working ?? doc.revisions[0] ?? null;
  // The preview follows the newest revision, whatever it is (owner): one just started shows nothing until its PDF is
  // in, one in preparation or in review its own PDF, one returned its returned copy, one released its stamped copy.
  const previewed = doc.revisions[0] ?? null;
  // The copy that says where it stands (stamped, returned, superseded, void, on hold), else the PDF as sent.
  const pdf = previewed ? openCopy(previewed.files) : null;
  // Just released after its review, where the project stamps: the stamped copy is a few seconds away; the page waits for it.
  const stampWaited = !!current && previewed?.id === current.id && !!current.releasedAt && Date.now() - current.releasedAt.getTime() < 120_000
    && current.cycles.length > 0 && !current.files.some((f) => f.kind === "STAMPED")
    && await (async () => {
      const { stampAnswers } = await import("@/lib/settings/stamp");
      const { orgSettings, projectSettings } = await import("@/lib/settings/api");
      const a = stampAnswers(await orgSettings().catch(() => new Map()), await projectSettings(ctx.projectId).catch(() => new Map()));
      return a.POLICY_PDF_STAMP !== "OFF" && a["STAMP:RELEASED"] !== "OFF";
    })();
  const native = previewed?.files.find((f) => f.kind === "NATIVE") ?? null;
  // The source file shown beside the PDF: the newest submission's, once through the virus check.
  const newestSubmission = previewed ? Math.max(0, ...previewed.files.map((f) => f.submission ?? 0)) : 0;
  const shownSource = previewed?.files.find((f) => f.kind === "NATIVE" && (f.submission ?? 0) === newestSubmission && f.status === "CLEAN") ?? null;
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
  const { policy: projectPolicy } = await import("@/lib/settings/control-activities");
  const together = (await projectPolicy(ctx, "POLICY_RELEASE")) === "TOGETHER";
  // What this organization calls each state; the states themselves are fixed.
  const names = await stateNames(ctx);
  // Why the next revision may be started: asked for by the last verdict, or
  // not — and then whoever starts it says why.
  const ground = doc.isPlaceholder ? { kind: "FIRST" as const } : await revisionGround(ctx, doc.id);
  // A type the organization does not review never goes down a route.
  const sentOut = !!current && transmittalItems.some((item) => item.revisionId === current.id && item.transmittal.direction === "OUTGOING");
  // Where releasing means go ahead, nobody is asked who receives it.
  const policy = await issuePolicy(ctx);
  const mayAsk = carrying ? await mayRequestIssue(ctx, carrying.id, user.id) || controller : false;
  const askChoices = mayAsk && carrying && policy.asked ? await requestChoices(ctx, doc) : null;
  const issueReasons = askChoices ? await getActiveSet("REASONS_FOR_ISSUE") : [];
  // Released and issued are one act unless the organization keeps them apart: when no request names who receives
  // it, the release asks, with the same fields as asking for it to be sent.
  const releaseTogether = (await controlPolicy(ctx, "POLICY_RELEASE")) !== "SEPARATE";
  // Releasing, the control function does not say who receives it: whoever decided the review or asked for it to be
  // sent did. It sees them, may take anyone off, and may add others (needed when nobody named anyone).
  const releaseChoices = controller && working?.state === "NOT_RELEASED" ? await requestChoices(ctx, doc) : null;
  const releaseReasons = releaseChoices ? await getActiveSet("REASONS_FOR_ISSUE") : [];
  const reasonLabel = new Map(releaseReasons.map((one) => [one.code, one.label] as const));
  const openAsks = requests.filter((one) => one.status === "OPEN");
  const whoReceives = releaseChoices ? (
    <div className="mb-3 rounded-md px-3 py-2.5 ring-1 ring-line">
      <ReleaseRecipients
        asked={openAsks.filter((one) => !one.delegated).map((one) => {
          const to = parseRecipients(one.recipients);
          return {
            id: one.id, reason: reasonLabel.get(one.reason) ?? one.reason, askedBy: one.raisedByName,
            people: to.internalUserIds.map((id) => ({ id, name: requestNames.people.get(id) ?? id })),
            parties: to.partyIds.map((id) => ({ id, name: requestNames.parties.get(id) ?? id })),
          };
        })}
        leftTo={openAsks.filter((one) => one.delegated).map((one) => one.raisedByName)}
        choices={{
          people: [...releaseChoices.proposed.map((one) => ({ id: one.id, name: one.name, detail: one.basis ? `${one.basis} · recommended` : "recommended" })), ...releaseChoices.others.map((one) => ({ id: one.id, name: one.name, detail: one.organization }))],
          parties: releaseChoices.parties,
        }}
        reasons={releaseReasons.map((one) => ({ code: one.code, label: one.label }))}
        required={releaseTogether}
      />
    </div>
  ) : null;

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
  // What each box of Edit rev holds now (owner: "under upload input it should indicate if i have an already uploaded
  // file"): the newest submission's PDF and source file.
  const workingNewest = working ? Math.max(0, ...working.files.map((f) => f.submission ?? 0)) : 0;
  const workingPdf = working?.files.find((f) => f.kind === "RENDITION" && (f.submission ?? 0) === workingNewest) ?? null;
  const workingSource = working?.files.find((f) => f.kind === "NATIVE" && (f.submission ?? 0) === workingNewest) ?? null;
  const run = working ? await getRunForRevision(ctx, working.id) : null;
  // The steps of its route, for choosing where a revision goes back to.
  const routeSteps = (run?.steps ?? []).map((step, index) => ({ number: index + 1, title: step.title ?? `Step ${index + 1}` }));
  // Sending back, and the hold: who it goes back to is the record's answer —
  // the supplier, or whoever started the route — and who is copied in starts as
  // the people who sat on the route. Only the control function sees either.
  const { returnRecipients, pendingIssue } = await import("@/lib/transmittals/issue-requests");
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
    ["Phase", label(phases, doc.phase)],
    ["Contract / PO", label(pos, doc.contractRef)],
    ["Criticality", label(criticalities, doc.criticality)],
    ["Confidentiality", label(confidentialities, doc.confidentiality)],
    ["Retention", label(retentions, doc.retentionClass)],
    ["Received", doc.receivedDate ? fmtDate(doc.receivedDate) : null],
    // The planned date, with what it says today: ready, submitted, overdue, at risk, or days left.
    ["Planned submission", doc.plannedDate ? [fmtDate(doc.plannedDate), plannedState(doc.plannedDate,
      plannedProgress(doc.revisions.some((r) => r.state === "RELEASED"), doc.revisions[0]?.backend.state ?? null),
      user.isInternal ? (await scheduleSource(ctx)).days.risk : DEFAULT_RISK_DAYS)?.word].filter(Boolean).join(" · ") : null],
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
  // What is offered to choose: the set of each list serving this document's deliverable type (Types & sets); every
  // value is still read by its name wherever the document already carries it.
  const serving = await servingOf(["DOCUMENT_TYPES", "DISCIPLINES", "CRITICALITY", "CONFIDENTIALITY", "RETENTION_CLASSES", "PHASES",
    ...own.filter((f) => f.setKey).map((f) => f.setKey!)]);
  const offer = <T extends { setId?: string | null }>(list: string, rows: T[]) => forType(serving, list, doc.deliverableType, rows);
  // The document's details, as one set of fields: the revision's edit step and
  // the Details tab both use these, so the two can never ask different things.
  const detailFields = (<>
    <Field label="Title" required><input name="title" defaultValue={doc.title} className={inputCls} /></Field>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Field label="Type"><Select name="docType" defaultValue={doc.docType} className={inputCls}>{offer("DOCUMENT_TYPES", types).filter((t) => t.status === "ACTIVE").map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</Select></Field>
      <Field label="Discipline"><Select name="discipline" defaultValue={doc.discipline} className={inputCls}>{offer("DISCIPLINES", disciplines).filter((d) => d.status === "ACTIVE").map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}</Select></Field>
      <Field label="Criticality"><Select name="criticality" defaultValue={doc.criticality ?? ""} className={inputCls}><option value="">—</option>{offer("CRITICALITY", criticalities).map((c) => <option key={c.code} value={c.code}>{c.label}{c.code === types.find((t) => t.code === doc.docType)?.props.criticality ? " (recommended)" : ""}</option>)}</Select></Field>
      <Field label="Confidentiality"><Select name="confidentiality" defaultValue={doc.confidentiality ?? ""} className={inputCls}>{offer("CONFIDENTIALITY", confidentialities).filter((c) => c.status === "ACTIVE" || c.code === doc.confidentiality).map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</Select></Field>
      <Field label="Retention"><Select name="retentionClass" defaultValue={doc.retentionClass ?? ""} className={inputCls}><option value="">—</option>{offer("RETENTION_CLASSES", retentions).map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</Select></Field>
      <Field label="Phase" hint="names its next revision"><Select name="phase" defaultValue={doc.phase ?? ""} className={inputCls}><option value="">—</option>{offer("PHASES", phases).map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</Select></Field>
      <Field label="Previous number"><input name="previousId" defaultValue={doc.previousId ?? ""} className={inputCls} /></Field>
    </div>
    {/* What the project's form adds (Forms & fields): its own fields and lists, each list offering its serving set. */}
    {own.length ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><OwnFields fields={own} values={answers} deliverableType={doc.deliverableType} serving={serving} /></div> : null}
    <input type="hidden" name="appVersion" value={doc.appVersion ?? ""} />
    <input type="hidden" name="legacyScheme" value={doc.legacyScheme ?? ""} />
  </>);
  // A schedule, disciplines-per-action or requirements list: its sheet to fill, where its file is attached.
  const typeProps = types.find((one) => one.code === doc.docType)?.props ?? {};
  const listKind = doc.docType === "SCH" ? "SCHEDULE" : typeProps.readsDepartments === true ? "DEPARTMENTS" : typeProps.readsRequirements === true ? "REQUIREMENTS" : null;
  const listTemplate = listKind
    ? <a href={`/api/plan-template/${listKind}`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline">Template to fill (.csv)</a>
    : null;
  const editing = canEdit && working && working.state === "IN_PREPARATION";
  const lead: StepItem[] = editing ? [{
    key: "edit", label: askedOf ? `Edit the details of rev ${working!.value}` : `Edit rev ${working!.value}`, open: !workingHasPdf && !askedOf, primary: !workingHasPdf && !askedOf, body: (
          <ActionForm action={editRevisionAction} submitLabel="Save" size="sm" hidden={{ revisionId: working!.id, id: doc.id, hasFiles: working!.files.length ? "yes" : "no" }}>
            {/* A supplier's: its files and what it is issued for are theirs; only our details change here. */}
            {askedOf ? (
              <p className="text-xs text-slate-500">It is with {askedOf}: its files are theirs to change, until they send it or hand it back.</p>
            ) : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="PDF" hint={workingPdf ? "a new one replaces it" : "what people will read — needed before it is sent"}>
                <input type="file" name="renditionFile" accept=".pdf" className="w-full" />
                <NowHeld file={workingPdf} />
              </Field>
              <Field label="Source file" hint={listKind
                ? `the editable original: the ${listKind === "SCHEDULE" ? "schedule's .xlsx, .csv or P6 .xer" : "list's .xlsx or .csv"}, read on release`
                : workingSource ? "a new one replaces it" : "optional — the editable original (.docx, .dwg, .xlsx…)"}>
                <input type="file" name="nativeFile" className="w-full" />
                <NowHeld file={workingSource} withType />
                {listTemplate}
              </Field>
            </div>}
            {detailFields}
          </ActionForm>
    ),
  }] : working && working.state === "IN_REVIEW" && (controller || working.cycles.some((one) => one.status === "OPEN" && one.openedById === user.id)) ? [{
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
                  <li key={one.id} className="rounded-md bg-tint-soft px-3 py-2.5 text-xs ring-1 ring-line">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800">{one.reason}</span>
                      <ToneChip tone={one.status === "DONE" ? "done" : one.status === "CANCELLED" ? "idle" : "waiting"}>
                        {one.status === "DONE" ? "sent" : one.status === "CANCELLED" ? "taken off" : "waiting"}
                      </ToneChip>
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
                    {one.releaseNote ? <p className="mt-1 whitespace-pre-line text-[11px] text-slate-500">{one.releaseNote}</p> : null}
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
                            {carrying.state === "RELEASED" ? "Waiting for the control function to send it." : "It goes out when the revision is released."}
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

          {/* Asking is the form itself: opening the step is the one click. */}
          {askChoices ? (
            <div className="mt-3 border-t border-line pt-3">
              <ActionForm action={requestIssueAction} submitLabel="Ask for it to be sent" size="sm" hidden={{ revisionId: carrying.id }}>
                <RequestIssue
                  asking
                  reasons={issueReasons.map((one) => ({ code: one.code, label: one.label }))}
                  proposed={askChoices.proposed}
                  others={askChoices.others}
                  parties={askChoices.parties}
                  ours={false}
                />
              </ActionForm>
            </div>
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

      ...(controller && working?.state === "NOT_RELEASED" ? [
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
              <p className={`mb-3 rounded-md px-3 py-2.5 text-xs ${decisionFinal ? "bg-tint-soft text-brand-ink ring-1 ring-line" : "bg-amber-50 text-amber-900 ring-1 ring-amber-200"}`}>
                The route settled on <strong>{working.statusCode} — {label(statuses, working.statusCode)}</strong>
                {decidedVerdict ? <> with <strong>{decidedVerdict}</strong></> : null}.
                {decisionFinal
                  ? " Releasing makes it the revision people work from, at that status. You do not choose it."
                  : " That verdict asks for changes, so this revision is not released: releasing it would replace the revision people are working from. Send it back."}
              </p>
              {decisionFinal ? (
                <ActionForm action={releaseRevisionAction} submitLabel={`Release as ${working.statusCode}`} size="sm" hidden={{ revisionId: working.id, statusCode: working.statusCode ?? "" }}>
                  {whoReceives}
                </ActionForm>
              ) : null}
              <details className="mt-3 border-t border-line pt-3" open={!decisionFinal}>
                <summary className="cursor-pointer text-xs font-semibold text-slate-600">{decisionFinal ? "Send it back instead" : "Send it back"}</summary>
                <div className="mt-2">
                  <ActionForm action={returnAtGateAction} submitLabel="Send it back" size="sm" hidden={{ revisionId: working.id }}>
                    <ReturnTarget steps={routeSteps} verdict={decisionFinal ? null : decidedVerdict} reasons={returnReasons.map((one) => ({ code: one.code, label: one.label, meaning: typeof one.props.meaning === "string" ? one.props.meaning : null }))} />
                    <CopyPicker companies={people} backTo={`${backTo.names} — when it goes back to its author`} preselected={[...new Set(routePeople.map((one) => one.userId))]} />
                  </ActionForm>
                </div>
              </details>
            </>
          ) : (
            <ActionForm action={releaseRevisionAction} submitLabel="Release" size="sm" hidden={{ revisionId: working.id }}>
              {whoReceives}
              <Field label="Released as" required hint="older revisions have no decided status; newer ones carry the reviewers' choice">
                <Select name="statusCode" className={inputCls} defaultValue="">
                  <option value="" disabled>Choose a status…</option>
                  {statuses.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.label}</option>)}
                </Select>
              </Field>
            </ActionForm>
          )}
          {current ? <p className="mt-2 text-[11px] text-slate-500">Rev {current.value} will be marked superseded.</p> : null}
        </>) },
      ] : []),

      // A supplier's document with the supplier: only they change it. The control function may ask for it back, saying why.
      ...(askedOf ? [
        { key: "asked", label: `With ${askedOf}`, open: !!openAsk, body: (<>
          <p className="text-xs leading-5 text-slate-600">
            {askedOf} holds it: only {askedOf} changes it, and sends it to us on a transmittal. To update it ourselves, ask them to hand it back.
          </p>
          {openAsk && !openAsk.fromSupplier ? (
            <p className="mt-2 whitespace-pre-line rounded-md bg-tint-soft px-3 py-2.5 text-xs leading-5 text-slate-700 ring-1 ring-line">
              <span className="font-semibold text-slate-800">Asked back</span> by {openAsk.askedBy}, {fmtDate(new Date(openAsk.askedAt))}: {openAsk.reason}
              <span className="block text-amber-800">Waiting for {askedOf} to answer.</span>
            </p>
          ) : controller ? (
            <details className="mt-3 text-xs open:basis-full">
              <summary className="ask cursor-pointer list-none [&::-webkit-details-marker]:hidden">Ask for it back</summary>
              <ActionForm action={askBackAction} submitLabel="Ask" size="sm" hidden={{ documentId: doc.id }} className="mt-3 space-y-3">
                <Field label="Why we need it back" required hint={`${askedOf} reads it, then hands it back or refuses with why`}>
                  <textarea name="reason" required rows={2} maxLength={2000} className={inputCls} />
                </Field>
              </ActionForm>
            </details>
          ) : null}
        </>) },
      ] : []),
      // With us: the supplier may ask for it back, and the control function answers; or we send it to them for an update.
      ...(user.isInternal && supplierName && withSupplier === false ? [
        openAsk && openAsk.fromSupplier
          ? { key: "asked-back", primary: controller, open: true, label: `${supplierName} asks for it back`, body: (<>
              <p className="whitespace-pre-line rounded-md bg-tint-soft px-3 py-2.5 text-xs leading-5 text-slate-700 ring-1 ring-line">
                <span className="font-semibold text-slate-800">{openAsk.askedBy}</span>, {fmtDate(new Date(openAsk.askedAt))}: {openAsk.reason}
                <span className="mt-1 block text-slate-600">Does the control function hand it back to {supplierName} to update it?{working && ["IN_PREPARATION", "RECEIVED"].includes(working.state) ? ` Rev ${working.value} goes as it is and comes back under the same value.` : ""}</span>
              </p>
              {controller ? (
                <ActionForm action={answerAskAction} submitLabel="Answer" size="sm" hidden={{ askId: openAsk.id, documentId: doc.id }} className="mt-3 space-y-3">
                  <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-slate-700">
                    <legend className="sr-only">Hand it back?</legend>
                    <label className="flex items-center gap-1.5"><input type="radio" name="accept" value="yes" required /> Hand it back</label>
                    <label className="flex items-center gap-1.5"><input type="radio" name="accept" value="no" required /> Keep it</label>
                  </fieldset>
                  <Field label="Why" hint={`${supplierName} reads it; required to keep it`}>
                    <textarea name="answer" rows={2} maxLength={2000} className={inputCls} />
                  </Field>
                </ActionForm>
              ) : null}
            </>) }
          : { key: "send-to-supplier", label: `With us — send it to ${supplierName} for an update`, body: (<>
              <p className="text-xs leading-5 text-slate-600">
                We hold it: only we change it now. Sending it to {supplierName} hands it to them to update it.
                {working && ["IN_PREPARATION", "RECEIVED"].includes(working.state) ? ` Rev ${working.value} goes as it is and comes back under the same value.` : ""}
              </p>
              {controller ? (
                <ActionForm action={sendToSupplierAction} submitLabel={`Send to ${supplierName}`} size="sm" hidden={{ documentId: doc.id }} className="mt-3 space-y-3">
                  <Field label="Message" hint={`what ${supplierName} reads with it: what to update`}>
                    <textarea name="note" rows={2} maxLength={4000} className={inputCls} />
                  </Field>
                </ActionForm>
              ) : null}
            </>) },
      ] : []),
      ...(canEdit && !askedOf && !working && doc.kind !== "RECORD" ? [
        { key: "revise", primary: ground.kind !== "OWN", label: ground.kind === "FIRST" ? "Start the first revision" : ground.kind === "ASKED" ? `New revision — answer rev ${doc.revisions[0]?.value}` : "Start a new revision", open: !doc.revisions.length, body: (<>
          <ActionForm action={prepareRevisionAction} submitLabel="Start revision" hidden={{ documentId: doc.id }}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* What it is issued for, from the organization's statuses: proposed now, confirmed or changed by the approver. */}
              <Field label="Issued for" required hint="the approver confirms it or changes it in the verdict" className="sm:col-span-2">
                <Select name="purpose" required defaultValue="" className={inputCls}>
                  <option value="" disabled>Choose…</option>
                  {statuses.filter((one) => one.status === "ACTIVE").map((one) => <option key={one.code} value={one.code}>{one.code} — {one.label}</option>)}
                </Select>
              </Field>
              {ground.kind === "FIRST" ? (
                <input type="hidden" name="reasonForRevision" value="First issue" />
              ) : ground.kind === "ASKED" ? (
                // The verdict is the reason; nobody writes it again.
                <div className="rounded-md bg-tint-soft px-3 py-2.5 text-xs text-slate-700 ring-1 ring-line sm:col-span-2">
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
              {/* The phase it is in, or the one it moves to: the new revision is named by that phase's line. */}
              {phases.length ? (
                <Field label="Phase" hint="names this revision (Settings, Revisions)">
                  <Select name="phase" className={inputCls} defaultValue={doc.phase ?? ""}>
                    {doc.phase ? null : <option value="">—</option>}
                    {offer("PHASES", phases).map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
                  </Select>
                </Field>
              ) : null}
              <Added fields={revisionPolicy.own} className="sm:col-span-2" />
              <Field label="PDF" hint="optional now — what people will read; needed before it is sent"><input type="file" name="renditionFile" accept=".pdf" className="w-full" /></Field>
              <Field label="Native file" hint="optional — the editable original (.docx, .dwg, .xlsx…)"><input type="file" name="nativeFile" className="w-full" />{listTemplate}</Field>
            </div>
          </ActionForm>
        </>) },
      ] : []),
  ];

  // Released, then held for an outside approval: on hold is what it is now.
  const onHold = shown?.state === "RELEASED" && !!shown.heldAt;
  // Asked of a supplier: its newest revision reads in the supplier's own set (sent, received, accepted…).
  const newest = doc.revisions[0]?.backend ?? null;
  const stage = supplierName && (!shown || shown.id === doc.revisions[0]?.id)
    ? supplierStage(true, newest ? { state: newest.state, resentAt: newest.resent?.at, returnedAt: newest.returnedAt } : null)
    : null;
  // Its stamp beside the number, in the reader's words: ours ("sent to supplier", "received"…), or, for the supplier
  // reading its own, theirs ("to be transmitted", "transmitted"…).
  const exchangedStage = doc.originator && context.transmittals.some((t) => t.itemKind === "PLACEHOLDER")
    ? supplierStage(true, newest ? { state: newest.state, resentAt: newest.resent?.at, returnedAt: newest.returnedAt } : null)
    : null;
  const exchangeStamp = exchangedStage ? supplierStamp(exchangedStage, user.isInternal ? "ours" : "theirs", doc.withSupplier) : null;
  const stateLabel = stage
    ? supplierStageName(names, stage, { together, held: onHold })
    : shown
    ? stateName(names, shown.state, { together, held: onHold })
    : docStateName(names, doc.state);
  const stateColor = onHold ? "bg-red-50/40 text-red-800 ring-red-300" : shown ? revStateColor(shown.state) : DOC_STATE_COLOR[doc.state as DocState] ?? "";

  return (
    <div className="space-y-4">
      {doc.asReceived ? <AsReceivedWarning who={supplierName ?? doc.originator ?? undefined} short /> : null}
      {doc.legalHold ? (
        <Banner tone="warn" title={`On legal hold${doc.legalHoldAt ? ` since ${fmtDate(doc.legalHoldAt)}` : ""}${doc.legalHoldBy ? ` — ${doc.legalHoldBy}` : ""}`}>
          {doc.legalHoldReason ?? "No reason was recorded."} While held it cannot be retired and no revision voided. New revisions and reviews go on.
        </Banner>
      ) : null}
      {/* Ended: why, where its state is read. */}
      {(doc.state === "CANCELLED" || doc.state === "WITHDRAWN") && doc.ended ? (
        <Banner tone="danger" title={`${doc.state === "CANCELLED" ? "Cancelled" : "Withdrawn"} ${fmtDate(doc.ended.at)} — ${doc.ended.by}`}>
          <span className="whitespace-pre-line">{doc.ended.reason}</span>
        </Banner>
      ) : null}
      {sp.filesRefused ? (
        <Banner tone="warn" title="Registered, without its files">
          {sp.filesRefused} Attach them with its first revision below.
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
        <div className="flex flex-col-reverse gap-3 px-5 pt-6 pb-3 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
              {doc.docNumber}
              {exchangeStamp ? <span className="stamp font-sans text-sky-700">{exchangeStamp}</span> : null}
              {doc.state === "CANCELLED" ? <span className="stamp font-sans text-slate-500">cancelled</span> : null}
              {doc.state === "WITHDRAWN" ? <span className="stamp font-sans text-red-700">withdrawn</span> : null}
              {doc.state === "ARCHIVED" ? <span className="stamp font-sans text-slate-500">archived</span> : null}
              {doc.revisions[0]?.state === "VOID" ? <span className="stamp font-sans text-red-700">rev {doc.revisions[0].value} void</span> : null}
              {doc.legalHold ? <span className="stamp font-sans text-amber-800">legal hold</span> : null}
              {doc.asReceived ? <span className="stamp font-sans text-red-700">as received</span> : null}
            </p>
            <h1 className="plate-name mt-1 min-w-0">{doc.title}</h1>
            <p className="plate-meta mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              {shown ? <span className="font-mono font-semibold text-slate-800">Rev {shown.value}</span> : null}
              {current?.heldAt ? <span className="stamp font-sans text-red-700">not for use</span> : null}
              {shown?.statusCode ? <span>&middot; {shown.statusCode} — {label(statuses, shown.statusCode)}</span> : null}
              {/* The plate is about the revision in use; this says what the one
                  after it is doing, in the register's words. */}
              {current && working ? <span className="text-amber-700">&middot; rev {working.value} {stateName(names, working.state).toLowerCase()}</span> : null}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
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
            <StateChip label={stateLabel} color={stateColor} />
            {pdf ? <a href={`/api/files/${pdf.id}`} target="_blank" title="Open the PDF" aria-label="Open the PDF" className="ask inline-flex items-center"><FileText className="h-3.5 w-3.5 text-red-700" aria-hidden /></a> : null}
            {native ? <a href={`/api/files/${native.id}?dl=1`} title="Download the source file" aria-label="Download the source file" className="ask inline-flex items-center"><FileDown className="h-3.5 w-3.5" aria-hidden /></a> : null}
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
            label: previewed ? `Preview · rev ${previewed.value}` : "Preview",
            // The PDF as it stands, and the source file where the page can show it (a picture, a workbook).
            content: (<>
              {pdf && stampWaited ? <StampPending /> : null}
              {previewed && checking(previewed.files).length ? <FilesChecking names={checking(previewed.files)} /> : null}
              <FilePreview pdf={pdf} source={shownSource} title={`${doc.docNumber} rev ${previewed?.value ?? ""}`} admin={isAdmin(user)} readers={await readersOn(ctx)} viewingNote={(await cookies()).get(PREF.viewingNote)?.value !== "0"} pdfDark={(await cookies()).get(PREF.pdfDark)?.value === "1"}
                empty={(
                  <div className="grid h-48 place-items-center p-6 text-center">
                    <div>
                      <FileText className="mx-auto h-8 w-8 text-slate-400" />
                      <p className="mt-2 text-sm font-semibold text-slate-700">{previewed ? `No PDF for rev ${previewed.value} yet` : "No PDF to show yet"}</p>
                      <p className="mt-1 text-xs text-slate-500">{working ? `Attach one to rev ${working.value} in the step above.` : "Start a revision to add content."}</p>
                    </div>
                  </div>
                )} />
            </>),
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
                <AlsoKnownAs documentId={doc.id} numbers={numbers} mayKeep={mayKeepNumbers} />
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
                {/* What was decided about it and is over now, each with why: the hold that was lifted, the end that was taken back. */}
                {(!doc.legalHold && doc.holdLifted) || (doc.reinstated && doc.state !== "CANCELLED" && doc.state !== "WITHDRAWN") || asks.some((one) => one.answeredAt) ? (
                  <div className="mt-4 space-y-2 border-t border-line pt-3 text-xs leading-5 text-slate-600">
                    {!doc.legalHold && doc.holdLifted ? (
                      <p className="whitespace-pre-line">
                        <span className="font-semibold text-slate-800">Legal hold lifted</span> {fmtDate(doc.holdLifted.at)} by {doc.holdLifted.by}: {doc.holdLifted.reason}
                        {doc.legalHoldReason ? <span className="block text-slate-500">It had been held {fmtDate(doc.legalHoldAt)}{doc.legalHoldBy ? ` by ${doc.legalHoldBy}` : ""}: {doc.legalHoldReason}</span> : null}
                      </p>
                    ) : null}
                    {doc.reinstated && doc.state !== "CANCELLED" && doc.state !== "WITHDRAWN" ? (
                      <p className="whitespace-pre-line">
                        <span className="font-semibold text-slate-800">Reinstated</span> {fmtDate(doc.reinstated.at)} by {doc.reinstated.by}: {doc.reinstated.reason}
                        {doc.ended ? <span className="block text-slate-500">It had been ended {fmtDate(doc.ended.at)} by {doc.ended.by}: {doc.ended.reason}</span> : null}
                      </p>
                    ) : null}
                    {/* Every ask to hand it back, with its answer beside it. */}
                    {asks.filter((one) => one.answeredAt).map((one) => (
                      <p key={one.id} className="whitespace-pre-line">
                        <span className="font-semibold text-slate-800">{one.accepted ? "Handed back" : "Not handed back"}</span> to {one.fromSupplier ? supplierName : "us"}, {fmtDate(new Date(one.answeredAt!))} by {one.answeredBy}{one.answer ? `: ${one.answer}` : ""}
                        <span className="block text-slate-500">Asked by {one.askedBy}, {fmtDate(new Date(one.askedAt))}: {one.reason}</span>
                      </p>
                    ))}
                  </div>
                ) : null}
                {/* Two different intentions, kept apart: hold keeps it as it is; ending it says it is finished. */}
                {controller ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer list-none text-xs font-semibold text-slate-500">{doc.legalHold ? "Lift the legal hold…" : "Put on legal hold…"}</summary>
                    <div className="mt-3 max-w-md">
                      <ActionForm action={setLegalHoldAction} submitLabel={doc.legalHold ? "Lift legal hold" : "Put on legal hold"} size="sm" variant="secondary" hidden={{ documentId: doc.id, hold: doc.legalHold ? "off" : "on" }}>
                        <Field label={doc.legalHold ? "Why it is lifted" : "Why it is held"} required hint={doc.legalHold ? "shown on the document with the hold's own reason" : "while held it cannot be ended and no revision voided; work on it goes on"}>
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
                  <RevisionRow key={rev.id} rev={rev} latest={index === 0} followedBy={index > 0 ? { value: doc.revisions[index - 1].value, why: doc.revisions[index - 1].reasonForRevision } : null} statusLabel={label(statuses, rev.statusCode)} stateLabel={stateName(names, rev.state, { together, held: !!rev.heldAt })} controller={controller} userId={user.id} userRole={user.role} voidIsControl={voidIsControl} held={doc.legalHold} />
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
                          {(() => {
                            const row = <>
                              <span className={`font-mono text-xs font-bold ${t.mayOpen ? "text-link" : "text-slate-600"}`}>{t.number}</span>
                              <span className="text-xs text-slate-500">rev {item.revision.value} · {prettyState(t.reasonForIssue)} · {fmtDate(t.dateOfIssue)}</span>
                              <span className="min-w-0 flex-1 truncate text-xs text-slate-700">{t.recipients.map((r) => r.name).join(", ") || "—"}</span>
                              <span className={`text-[11px] font-semibold ${seen === t.recipients.length && seen ? "text-emerald-700" : "text-slate-500"}`}>{seen}/{t.recipients.length} have seen it</span>
                            </>;
                            // One the reader may not open is listed, not linked.
                            return t.mayOpen
                              ? <Link href={`/transmittals/${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-slate-50">{row}</Link>
                              : <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">{row}</div>;
                          })()}
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
                            <button className="text-red-600/80 hover:text-red-700" title="Take this link off" aria-label="Take this link off"><X className="h-3.5 w-3.5" aria-hidden /></button>
                          </form>
                        ) : null}
                      </UsedIn>
                    ) : null)}
                  </ul>
                )}
                {actionChoices.length ? (
                  <details className="border-t border-line py-3">
                    <summary className="cursor-pointer list-none text-xs font-semibold text-link">+ Add to a schedule action</summary>
                    <div className="mt-2 max-w-md">
                      <ActionForm action={addDocumentToActionAction} submitLabel="Add" size="sm" hidden={{ documentIds: doc.id, department: doc.discipline }} className="space-y-3">
                        <Field label="Action" required>
                          <Select name="actionId" required className={inputCls} defaultValue="">
                            <option value="" disabled hidden>Action</option>
                            {actionChoices.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}{a.start ? ` · ${fmtDate(a.start)}` : ""}</option>)}
                          </Select>
                        </Field>
                        <p className="text-[11px] text-slate-500">For {label(disciplines, doc.discipline)}, its discipline: only actions that concern it are listed.</p>
                      </ActionForm>
                    </div>
                  </details>
                ) : null}
                {canEdit ? (
                  <details className="border-t border-line py-3">
                    <summary className="cursor-pointer list-none text-xs font-semibold text-link">+ Link an asset</summary>
                    <div className="mt-2 max-w-md">
                      <ActionForm action={linkAssetAction} submitLabel="Link" size="sm" hidden={{ documentId: doc.id }}>
                        <Select name="assetCode" className={inputCls} defaultValue="">
                          <option value="" disabled>Choose…</option>
                          {assets.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                        </Select>
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
                          {e.field ? <span className="text-slate-400"> · {e.field}: {e.oldValue ?? "—"} → {e.newValue ?? "—"}</span> : e.newValue ? <span className="text-slate-400"> · {plain(readableDetail(e.newValue)?.replaceAll("\n", " · "))}</span> : e.detail ? <span className="text-slate-400"> · {plain(readableDetail(e.detail)?.replaceAll("\n", " · "))}</span> : null}
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

/** What a file box of a revision holds now, under it: its name (and, for the source file, what kind of file it is), or that it holds none. */
function NowHeld({ file, withType = false }: { file: { name: string } | null; withType?: boolean }) {
  if (!file) return <p className="mt-1 text-[11px] text-slate-500">None yet</p>;
  const ext = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  const KINDS: Record<string, string> = {
    xlsx: "Excel workbook", xlsm: "Excel workbook", xls: "Excel workbook (old format)", csv: "CSV table", xer: "P6 schedule",
    docx: "Word document", doc: "Word document (old format)", dwg: "AutoCAD drawing", dxf: "drawing exchange file", pptx: "PowerPoint",
    jpg: "picture", jpeg: "picture", png: "picture", gif: "picture", webp: "picture", zip: "zip archive", ifc: "IFC model",
  };
  return (
    <p className="mt-1 truncate text-[11px] text-slate-600" title={file.name}>
      Now: <span className="font-semibold">{file.name}</span>{withType ? <span className="text-slate-500"> · {KINDS[ext] ?? (ext ? `.${ext} file` : "file")}</span> : null}
    </p>
  );
}
