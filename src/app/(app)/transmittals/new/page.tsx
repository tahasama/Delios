import { activityDetail } from "@/lib/api/schedule";
import { PageHeader } from "@/components/ui";
import { formPolicy } from "@/lib/field-policy";
import { requireScope } from "@/lib/scope";
import { getActiveSet } from "@/lib/config";
import { holdersOf } from "@/lib/permissions";
import { recipientCompanies } from "@/lib/recipients";
import { NewTransmittalForm } from "./new-transmittal-form";
import { api, projectPath } from "@/lib/api/client";
import { backendDocument } from "@/lib/api/legacy";
import { addressees, backendTransmittal, ourOrganizationName } from "@/lib/api/transmittals";
import type { RegisterPage } from "@/lib/api/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "New transmittal" };

type Search = { doc?: string; docs?: string; direction?: string; revisions?: string; users?: string; to?: string; reason?: string; party?: string; subject?: string; message?: string; replyTo?: string; follows?: string; kind?: string; activity?: string; ask?: string; placeholders?: string; askBack?: string };

export default async function NewTransmittalPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireScope();
  const policy = await formPolicy(ctx, "TRANSMITTAL");
  const sp = await searchParams;

  const ourOrganization = await ourOrganizationName();
  const [reasons, register, found, reviewers] = await Promise.all([
    getActiveSet("REASONS_FOR_ISSUE"),
    // The register's newest documents, each with its released revision and the
    // one being worked on: what can be enclosed.
    api<RegisterPage>(projectPath(ctx, "/register"), { query: { per: 250 } }),
    addressees(ctx),
    holdersOf(ctx, "REVIEW"),
  ]);
  const revisionRows = register.rows.flatMap((doc) => [
    ...(doc.releasedRevisionId ? [{ id: doc.releasedRevisionId, value: doc.releasedRevision ?? "", statusCode: doc.releasedStatus, state: "RELEASED", document: { docNumber: doc.number, title: doc.title } }] : []),
    ...(doc.latestRevisionId && doc.latestRevisionId !== doc.releasedRevisionId && (doc.revisionState === "IN_PREPARATION" || doc.revisionState === "IN_REVIEW")
      ? [{ id: doc.latestRevisionId, value: doc.revision ?? "", statusCode: doc.proposedStatus, state: doc.revisionState, document: { docNumber: doc.number, title: doc.title } }]
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
  const selectedDocumentIds = [...new Set([...(sp.docs ?? "").split(","), ...(sp.doc ? [sp.doc] : [])].map((value) => value.trim()).filter(Boolean))];
  const selectedDocuments = await Promise.all(selectedDocumentIds.map((one) => backendDocument(ctx, one)));
  const preselected = selectedDocuments.flatMap((document) => {
    const released = document?.revisions.filter((one) => one.state === "RELEASED").sort((a, b) => (b.releasedAt ?? "").localeCompare(a.releasedAt ?? ""))[0];
    return released ? [released.id] : [];
  });

  // A supplier's documents with nothing released, asked of them as placeholders: the one exception to "only released
  // revisions travel". Only Document Control asks; only one supplier's at a time, sent to that supplier.
  const askedIds = ctx.can("CONTROL") ? [...new Set((sp.placeholders ?? "").split(",").map((one) => one.trim()).filter(Boolean))] : [];
  const askedDocs = (await Promise.all(askedIds.map((one) => backendDocument(ctx, one))))
    .filter((d): d is NonNullable<typeof d> => !!d && !d.revisions.some((r) => r.state === "RELEASED" || r.state === "SUPERSEDED"));
  // A supplier's documents it holds, asked back for an update: the ask goes on this transmittal, to that supplier.
  const backIds = ctx.can("CONTROL") && !askedIds.length ? [...new Set((sp.askBack ?? "").split(",").map((one) => one.trim()).filter(Boolean))] : [];
  const backDocs = (await Promise.all(backIds.map((one) => backendDocument(ctx, one))))
    .filter((d): d is NonNullable<typeof d> => !!d && d.withSupplier === true);
  const owners = [...new Set([...askedDocs, ...backDocs].map((d) => d.originator))];
  const supplier = owners.length === 1 ? found.parties.find((p) => p.code === owners[0]) ?? null : null;
  const placeholders = supplier ? askedDocs.map((d) => ({ id: d.id, number: d.number, title: d.title })) : [];
  const askingBack = supplier ? backDocs.map((d) => ({ id: d.id, number: d.number, title: d.title })) : [];
  // Asking back is an information transmittal: a request.
  const requestReason = reasons.find((r) => r.code === "REQUEST") ?? reasons.find((r) => r.props.family === "Information") ?? null;
  // Sent to that supplier: its people on this project, or the organization itself when none has an account.
  const supplierPeople = supplier ? found.people.filter((one) => one.organization === supplier.name).map((one) => one.id) : [];
  const supplierTo = supplier ? (supplierPeople.length ? supplierPeople : [`party:${supplier.id}`]) : [];

  // Placeholders not asked yet, per supplier: Document Control may ask them on a new transmittal, one supplier's at a time.
  const askable = ctx.can("CONTROL") && ctx.user.isInternal && !placeholders.length
    ? [...register.rows.filter((d) => d.originator && !d.releasedRevisionId && !d.supplier && d.state !== "CANCELLED" && d.state !== "WITHDRAWN")
        .reduce((by, d) => {
          const name = found.parties.find((p) => p.code === d.originator)?.name;
          if (!name) return by;
          by.set(name, [...(by.get(name) ?? []), { id: d.id, number: d.number, title: d.title }]);
          return by;
        }, new Map<string, { id: string; number: string; title: string }[]>())]
        .map(([supplier, items]) => ({ supplier, items }))
    : [];

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
        // Another organization's people send to us; Document Control may record what reached us outside the system.
        defaultDirection={!ctx.user.isInternal || (sp.direction === "INCOMING" && ctx.can("CONTROL")) ? "INCOMING" : "OUTGOING"}
        mayRecordReceived={ctx.user.isInternal && ctx.can("CONTROL")}
        askable={askable}
        askingBack={askingBack.length ? { to: supplier!.name, items: askingBack } : undefined}
        outsider={!ctx.user.isInternal}
        preselectedRevisionIds={preselected}
        placeholders={placeholders.length ? { to: supplier!.name, items: placeholders, mixed: owners.length > 1 } : askedIds.length && owners.length > 1 ? { to: "", items: [], mixed: true } : undefined}
        prefill={{
          revisionIds: following ? following.items.map((one) => one.revisionId) : (sp.revisions ?? "").split(",").filter(Boolean),
          userIds: following ? followTo : answering ? answerTo : supplierTo.length ? supplierTo : (sp.users ?? "").split(",").filter(Boolean),
          copyIds: following ? followCopies : answerCopies,
          outsiders: sp.to,
          reason: following?.reasonForIssue ?? (askingBack.length ? requestReason?.code : undefined) ?? sp.reason,
          party: answering && answering.direction === "INCOMING" ? answering.issuingParty : sp.party,
          subject: askingBack.length && !sp.subject
            ? `${askingBack.length === 1 ? askingBack[0].number : `${askingBack.length} documents`}: back for an update`
            : placeholders.length && !following && !answering && !sp.subject
            ? `${placeholders.length === 1 ? placeholders[0].number : `${placeholders.length} documents`} to send`
            // The subject stays the first one's: the mention says what it follows, no prefix needed.
            : following
              ? following.subject ?? undefined
              : answering
                ? answering.subject ?? undefined
                : sp.subject,
          message: sp.message,
          answering: answering ? { id: answering.id, number: answering.number, subject: answering.subject } : undefined,
          following: following ? { id: following.id, number: following.number, kind: followKind, rejection: following.rejectionReason } : undefined,
          activity: asked ? { id: asked.activity.id, code: asked.activity.code, ask: sp.ask === "DISCIPLINE" ? "DISCIPLINE" : "DOCUMENT" } : undefined,
        }}
      />
    </div>
  );
}
