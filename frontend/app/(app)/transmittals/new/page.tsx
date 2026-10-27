import { activityDetail } from "@/lib/actions/api";
import { PageHeader } from "@/components/ui";
import { formPolicy } from "@/lib/settings/field-policy";
import { requireScope } from "@/lib/core/scope";
import { getActiveSet } from "@/lib/settings/config";
import { holdersOf } from "@/lib/core/permissions";
import { recipientCompanies } from "@/lib/transmittals/recipients";
import { NewTransmittalForm } from "./new-transmittal-form";
import { api, projectPath } from "@/lib/client";
import { backendDocuments } from "@/lib/documents/api";
import { addressees, backendTransmittal, ourOrganizationName } from "@/lib/transmittals/api";
import type { RegisterPage } from "@/lib/types";
import { packageByNumber } from "@/lib/packages/api";

export const dynamic = "force-dynamic";
export const metadata = { title: "New transmittal" };

type Search = { step?: string; answer?: string; due?: string; doc?: string; docs?: string; direction?: string; revisions?: string; users?: string; to?: string; reason?: string; party?: string; subject?: string; message?: string; replyTo?: string; follows?: string; kind?: string; activity?: string; ask?: string; placeholders?: string; askBack?: string; pkg?: string; join?: string; package?: string };

export default async function NewTransmittalPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireScope();
  const policy = await formPolicy(ctx, "TRANSMITTAL");
  const sp = await searchParams;

  const ourOrganization = await ourOrganizationName();
  const [reasons, register, found, reviewers] = await Promise.all([
    getActiveSet("REASONS_FOR_ISSUE"),
    // The register's newest documents, each with its released revision and the
    // one being worked on: what can be enclosed.
    api<RegisterPage>(projectPath(ctx, "/register"), { keep: { areas: ["docs", "reviews", "transmittals", "packages"] }, query: { per: 250 } }),
    addressees(ctx),
    holdersOf(ctx, "REVIEW"),
  ]);
  const revisionRows = register.rows.flatMap((doc) => [
    ...(doc.releasedRevisionId ? [{ id: doc.releasedRevisionId, value: doc.releasedRevision ?? "", statusCode: doc.releasedStatus, state: "RELEASED", document: { id: doc.id, docNumber: doc.number, title: doc.title } }] : []),
    ...(doc.latestRevisionId && doc.latestRevisionId !== doc.releasedRevisionId && (doc.revisionState === "IN_PREPARATION" || doc.revisionState === "IN_REVIEW")
      ? [{ id: doc.latestRevisionId, value: doc.revision ?? "", statusCode: doc.proposedStatus, state: doc.revisionState, document: { id: doc.id, docNumber: doc.number, title: doc.title } }]
      : []),
  ]).slice(0, 200);
  const users = found.people.map((one) => ({ id: one.id, name: one.name, role: one.function }));

  // Companies with people who can receive something — see recipientCompanies.
  const companies = await recipientCompanies(ctx);

  // The backend names who a transmittal went to; their accounts and parties are found by name.
  const personByName = new Map(found.people.map((one) => [one.name, one.id]));
  const partyByName = new Map(found.parties.map((one) => [one.name, one.id]));

  // Answering something: the question decides who this goes to. Whoever sent
  // it is addressed, the people copied in on the question are copied in on the
  // answer, and the subject carries the thread. All of it is editable — it is a
  // starting point, not a rule.
  // "Follow up" is the one way to answer or complete a transmittal: one we sent is completed (its documents and people
  // carried over); anything else is answered, back to whoever sent it. Either way the new one mentions it.
  const followed = sp.follows ? await backendTransmittal(ctx, sp.follows) : null;
  const followedIsOurs = !!followed && ctx.user.isInternal && followed.direction === "OUTGOING";
  const question = sp.replyTo ? await backendTransmittal(ctx, sp.replyTo) : followed && !followedIsOurs ? followed : null;
  const answering = question
    ? { id: question.id, number: question.number, subject: question.subject as string | null, direction: question.direction, issuingParty: question.from ?? question.issuedBy }
    : null;
  const answerTo = question
    ? question.direction === "OUTGOING"
      // We sent it, so the answer comes back to whoever raised it.
      ? [personByName.get(question.issuedBy)].filter((id): id is string => !!id)
      // It came from outside; the answer goes back to that company, and the
      // people it named are the ones who know about it.
      : question.recipients.filter((one) => one.person).map((one) => personByName.get(one.name)).filter((id): id is string => !!id)
    : [];
  const answerCopies: string[] = [];

  // Completing or correcting something we sent: the new transmittal starts as a
  // copy of the first — its reason, its people, its documents — and the sender
  // changes what was missing. The first stays exactly as it went.
  const followKind = sp.kind === "REPLACES" ? "REPLACES" : "SUPPLEMENT";
  const first = followedIsOurs ? followed : null;
  const following = first
    ? { id: first.id, number: first.number, subject: first.subject as string | null, reasonForIssue: first.reason, rejectionReason: null as string | null, items: first.items.filter((one) => one.revisionId).map((one) => ({ revisionId: one.revisionId! })) }
    : null;
  const followTo = first && following
    ? first.recipients.map((one) => (one.person ? personByName.get(one.name) : partyByName.get(one.organization ?? one.name) ? `party:${partyByName.get(one.organization ?? one.name)}` : undefined))
        .filter((id): id is string => !!id)
    : [];
  const followCopies: string[] = [];

  // Asking for a document to be added to a schedule action.
  const asked = sp.activity ? await activityDetail(ctx, sp.activity).catch(() => null) : null;
  // A package's documents going out (owner: delivering a package is a data transmittal): a package we deliver sends what
  // is ready, to whom it names; a supplier's package, its documents, to whom the sender chooses. Sent, the backend
  // checks they are the package's and delivers a package of ours (PackageService.SendableAsync / DeliveredAsync).
  const forPkg = sp.package && ctx.user.isInternal ? await packageByNumber(ctx, sp.package).catch(() => null) : null;
  const pkgDocs = forPkg ? (forPkg.kind === "DELIVERY" ? forPkg.members.filter((m) => m.ready) : forPkg.members).map((m) => m.documentId) : [];
  const selectedDocumentIds = [...new Set([...(sp.docs ?? "").split(","), ...(sp.doc ? [sp.doc] : []), ...pkgDocs].map((value) => value.trim()).filter(Boolean))];
  const askedIds = ctx.can("CONTROL") ? [...new Set((sp.placeholders ?? "").split(",").map((one) => one.trim()).filter(Boolean))] : [];
  const backIds = ctx.can("CONTROL") && !askedIds.length ? [...new Set((sp.askBack ?? "").split(",").map((one) => one.trim()).filter(Boolean))] : [];
  // Every document the form starts with, in one read.
  const read = new Map((await backendDocuments(ctx, [...selectedDocumentIds, ...askedIds, ...backIds])).map((one) => [one.id, one]));
  const selectedDocuments = selectedDocumentIds.map((one) => read.get(one) ?? null);
  // Sent out, a document goes at its released revision; recorded as received, at its newest one.
  const incoming = sp.direction === "INCOMING";
  const going = selectedDocuments.map((document) => {
    const released = document?.revisions.filter((one) => one.state === "RELEASED").sort((a, b) => (b.releasedAt ?? "").localeCompare(a.releasedAt ?? ""))[0];
    const newest = incoming ? document?.revisions.find((one) => one.state !== "VOID") : undefined;
    return { document, revision: released ?? newest ?? null };
  });
  const preselected = going.flatMap((one) => (one.revision ? [one.revision.id] : []));
  const unsent = going.filter((one) => one.document && !one.revision).map((one) => one.document!.number);
  // Picked in the register, a revision may not be among the newest listed here: it is added, so it shows as enclosed.
  for (const one of going) {
    if (!one.document || !one.revision || revisionRows.some((r) => r.id === one.revision!.id)) continue;
    revisionRows.push({ id: one.revision.id, value: one.revision.value, statusCode: one.revision.statusCode ?? null, state: one.revision.state, document: { id: one.document.id, docNumber: one.document.number, title: one.document.title } });
  }

  // A supplier's documents with nothing released, asked of them as placeholders: the one exception to "only released
  // revisions travel". Only the control function asks; only one supplier's at a time, sent to that supplier.
  const askedDocs = askedIds.map((one) => read.get(one))
    .filter((d): d is NonNullable<typeof d> => !!d && !d.revisions.some((r) => r.state === "RELEASED" || r.state === "SUPERSEDED"));
  // A supplier's documents it holds, asked back for an update: the ask goes on this transmittal, to that supplier.
  const backDocs = backIds.map((one) => read.get(one))
    .filter((d): d is NonNullable<typeof d> => !!d && d.withSupplier === true);
  const owners = [...new Set([...askedDocs, ...backDocs].map((d) => d.originator))];
  const supplier = owners.length === 1 ? found.parties.find((p) => p.code === owners[0]) ?? null : null;
  const placeholders = supplier ? askedDocs.map((d) => ({ id: d.id, number: d.number, title: d.title })) : [];
  const askingBack = supplier ? backDocs.map((d) => ({ id: d.id, number: d.number, title: d.title })) : [];
  // Asking back is an information transmittal: a request.
  const requestReason = reasons.find((r) => r.code === "REQUEST") ?? reasons.find((r) => r.props.family === "Information") ?? null;
  // A follow-up carrying no document is a letter: it answers (information) rather than repeat a data reason it cannot carry.
  const answerReason = reasons.find((r) => r.code === "ANSWER") ?? requestReason;
  const isData = (code: string | null | undefined) => reasons.find((r) => r.code === code)?.props.family !== "Information";
  // Sent to that supplier: its people on this project, or the organization itself when none has an account.
  const supplierPeople = supplier ? found.people.filter((one) => one.organization === supplier.name).map((one) => one.id) : [];
  const supplierTo = supplier ? (supplierPeople.length ? supplierPeople : [`party:${supplier.id}`]) : [];
  // A package we deliver goes to whom it names: each organization's people (or the organization), and inside our own
  // organization to whoever accepts it.
  const deliverTo = forPkg?.kind === "DELIVERY"
    ? [...new Set(forPkg.recipientPartyIds.flatMap((id) => {
        const party = found.parties.find((p) => p.id === id);
        if (!party) return forPkg.acceptorIds;
        const people = found.people.filter((one) => one.organization === party.name).map((one) => one.id);
        return people.length ? people : [`party:${party.id}`];
      }))]
    : [];

  // Someone new asked to join (People & access, the directory): the person's fields, and who confirms. Only where it is
  // asked of someone; put on at once, it is no letter and stays where it was.
  type JoinOptions = { functions: { id: string; name: string }[]; ours: { id: string; name: string }[]; guests: { id: string; name: string }[];
    confirmers: { id: string; name: string; function: string; manager: boolean }[]; asks: boolean };
  const joinOptions = sp.join === "1" && ctx.user.isInternal ? await api<JoinOptions>(projectPath(ctx, "/people/join-options"), { keep: { areas: [] } }).catch(() => null) : null;
  const disciplines = (await getActiveSet("DISCIPLINES")).map((one) => ({ code: one.code, label: one.label })).sort((x, y) => x.label.localeCompare(y.label));
  const joining = joinOptions?.asks ? {
    projectCode: ctx.project.code,
    ourParties: joinOptions.ours.map((p) => ({ value: p.id, label: p.name })),
    guestParties: joinOptions.guests.map((p) => ({ value: p.id, label: p.name })),
    functions: joinOptions.functions.map((f) => ({ value: f.id, label: f.name })),
    disciplines: disciplines.map((d) => ({ value: d.code, label: d.label })),
    confirmers: joinOptions.confirmers.map((c) => ({ id: c.id, name: c.name, detail: c.function, note: c.manager ? "recommended" : null })),
    mayKeepProof: ctx.can("CONTROL"),
  } : undefined;


  return (
    <div>
      <PageHeader
        title="New transmittal"
        subtitle="Documents, or a letter, sent to named people — or something that reached us from outside, recorded so it enters the register."
      />
      <NewTransmittalForm
        fields={policy.rules}
        labels={policy.labels}
        ownFields={policy.own}
        reasons={reasons.map((r) => ({ code: r.code, label: r.label, props: r.props }))}
        revisions={revisionRows.map((r) => ({
          id: r.id,
          documentId: r.document.id,
          label: `${r.document.docNumber} rev ${r.value}${r.statusCode ? ` · ${r.statusCode}` : ""} — ${r.document.title}`,
          released: r.state === "RELEASED",
          number: r.document.docNumber,
          rev: r.value,
          status: r.statusCode,
          title: r.document.title,
        }))}
        users={users.map((u) => ({ id: u.id, name: u.name, role: u.role }))}
        reviewers={reviewers.map((u) => ({ id: u.id, name: u.name, role: u.functionName }))}
        companies={companies}
        ourOrganization={ourOrganization}
        // Sending is what the form is mostly for, so it opens on sending —
        // replies included. Only a link that asks to record something
        // received opens the other way.
        // Another organization's people send to us; the control function may record what reached us outside the system.
        defaultDirection={!ctx.user.isInternal || (sp.direction === "INCOMING" && ctx.can("CONTROL")) ? "INCOMING" : "OUTGOING"}
        mayRecordReceived={ctx.user.isInternal && ctx.can("CONTROL")}
        askingBack={askingBack.length ? { to: supplier!.name, items: askingBack } : undefined}
        outsider={!ctx.user.isInternal}
        preselectedRevisionIds={preselected}
        unsent={unsent}
        parties={found.parties.map((p) => ({ id: p.id, code: p.code, name: p.name }))}
        forPackage={forPkg ? { id: forPkg.id, number: forPkg.number, title: forPkg.title, delivers: forPkg.kind === "DELIVERY", to: forPkg.names.to } : undefined}
        joining={joining}
        placeholders={placeholders.length ? { to: supplier!.name, items: placeholders, mixed: owners.length > 1 } : askedIds.length && owners.length > 1 ? { to: "", items: [], mixed: true } : undefined}
        prefill={{
          step: sp.step === "2" ? 2 : undefined,
          answer: sp.answer === "1" ? true : sp.answer === "0" ? false : undefined,
          due: sp.due,
          revisionIds: following ? following.items.map((one) => one.revisionId) : (sp.revisions ?? "").split(",").filter(Boolean),
          userIds: following ? followTo : answering ? answerTo : supplierTo.length ? supplierTo : deliverTo.length ? deliverTo : (sp.users ?? "").split(",").filter(Boolean),
          copyIds: following ? followCopies : answerCopies,
          outsiders: sp.to,
          reason: (following && !following.items.length && isData(following.reasonForIssue) ? answerReason?.code : following?.reasonForIssue) ?? (askingBack.length ? requestReason?.code : undefined)
            ?? (placeholders.length && reasons.some((r) => r.code === "IFU") ? "IFU" : undefined) ?? (joining ? requestReason?.code : undefined)
            ?? (forPkg?.kind === "DELIVERY" ? forPkg.reason : undefined) ?? sp.reason,
          party: answering && answering.direction === "INCOMING" ? answering.issuingParty : sp.party,
          // One short line whatever the count: the package, how many, to whom. The documents are listed on it.
          subject: askingBack.length && !sp.subject
            ? `${sp.pkg ? `${sp.pkg} — ` : ""}${askingBack.length} document${askingBack.length === 1 ? "" : "s"} asked back from ${supplier!.name}`
            : placeholders.length && !following && !answering && !sp.subject
            ? `${sp.pkg ? `${sp.pkg} — ` : ""}${placeholders.length} document${placeholders.length === 1 ? "" : "s"} submitted to ${supplier!.name}`
            : forPkg && !sp.subject
            ? `${forPkg.number} ${forPkg.title}: ${pkgDocs.length} document${pkgDocs.length === 1 ? "" : "s"}`
            // The subject stays the first one's: the mention says what it follows, no prefix needed.
            : following
              ? following.subject ?? undefined
              : answering
                ? answering.subject ?? undefined
                : sp.subject,
          message: sp.message ?? (placeholders.length && !following && !answering
            ? `Please provide the ${placeholders.length === 1 ? "document" : "documents"} listed on this transmittal, each by its planned date.`
            : undefined),
          answering: answering ? { id: answering.id, number: answering.number, subject: answering.subject } : undefined,
          following: following ? { id: following.id, number: following.number, kind: followKind, rejection: following.rejectionReason } : undefined,
          activity: asked ? {
            id: asked.activity.id, code: asked.activity.code, ask: sp.ask === "DISCIPLINE" ? "DISCIPLINE" : "DOCUMENT",
            disciplines, tagged: asked.activity.departments ?? [],
          } : undefined,
        }}
      />
    </div>
  );
}
