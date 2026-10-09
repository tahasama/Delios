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

type Search = { doc?: string; docs?: string; direction?: string; revisions?: string; users?: string; to?: string; reason?: string; party?: string; subject?: string; message?: string; replyTo?: string; follows?: string; kind?: string };

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
  const question = sp.replyTo ? await backendTransmittal(ctx, sp.replyTo) : null;
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
  const first = sp.follows ? await backendTransmittal(ctx, sp.follows) : null;
  const following = first && first.direction === "OUTGOING"
    ? { id: first.id, number: first.number, subject: first.subject as string | null, reasonForIssue: first.reason, rejectionReason: null as string | null, items: first.items.filter((one) => one.revisionId).map((one) => ({ revisionId: one.revisionId! })) }
    : null;
  const followTo = first && following
    ? first.recipients.map((one) => (one.person ? personByName.get(one.name) : partyByName.get(one.organization ?? one.name) ? `party:${partyByName.get(one.organization ?? one.name)}` : undefined))
        .filter((id): id is string => !!id)
    : [];
  const followCopies: string[] = [];

  const selectedDocumentIds = [...new Set([...(sp.docs ?? "").split(","), ...(sp.doc ? [sp.doc] : [])].map((value) => value.trim()).filter(Boolean))];
  const selectedDocuments = await Promise.all(selectedDocumentIds.map((one) => backendDocument(ctx, one)));
  const preselected = selectedDocuments.flatMap((document) => {
    const released = document?.revisions.filter((one) => one.state === "RELEASED").sort((a, b) => (b.releasedAt ?? "").localeCompare(a.releasedAt ?? ""))[0];
    return released ? [released.id] : [];
  });

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
        defaultDirection={sp.direction === "INCOMING" ? "INCOMING" : "OUTGOING"}
        preselectedRevisionIds={preselected}
        prefill={{
          revisionIds: following ? following.items.map((one) => one.revisionId) : (sp.revisions ?? "").split(",").filter(Boolean),
          userIds: following ? followTo : answering ? answerTo : (sp.users ?? "").split(",").filter(Boolean),
          copyIds: following ? followCopies : answerCopies,
          outsiders: sp.to,
          reason: following?.reasonForIssue ?? sp.reason,
          party: answering && answering.direction === "INCOMING" ? answering.issuingParty : sp.party,
          subject: following
            ? `${followKind === "REPLACES" ? "Replaces" : "Supplement to"} ${following.number}${following.subject ? ` — ${following.subject}` : ""}`
            : answering
              ? `RE: ${answering.subject ?? answering.number}`
              : sp.subject,
          message: sp.message,
          answering: answering ? { id: answering.id, number: answering.number, subject: answering.subject } : undefined,
          following: following ? { id: following.id, number: following.number, kind: followKind, rejection: following.rejectionReason } : undefined,
        }}
      />
    </div>
  );
}
