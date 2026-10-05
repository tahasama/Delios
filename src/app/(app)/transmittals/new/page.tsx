import { PageHeader } from "@/components/ui";
import { formPolicy } from "@/lib/field-policy";
import { requireScope } from "@/lib/scope";
import { getActiveSet } from "@/lib/config";
import { holdersOf } from "@/lib/permissions";
import { recipientCompanies } from "@/lib/recipients";
import { NewTransmittalForm } from "./new-transmittal-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New transmittal" };

type Search = { doc?: string; docs?: string; direction?: string; revisions?: string; users?: string; to?: string; reason?: string; party?: string; subject?: string; message?: string; replyTo?: string; follows?: string; kind?: string };

export default async function NewTransmittalPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireScope();
  const policy = await formPolicy(ctx, "TRANSMITTAL");
  const { db } = ctx;
  const sp = await searchParams;

  const ourOrganization = (await db.party.findFirst({ where: { isInternal: true }, select: { name: true } }))?.name ?? "Our organization";
  const [reasons, revisionRows, users, reviewers] = await Promise.all([
    getActiveSet("REASONS_FOR_ISSUE"),
    db.revision.findMany({
      // What is on hold is not for use, so it is not offered for sending.
      where: { state: { in: ["RELEASED", "IN_PREPARATION", "IN_REVIEW"] }, heldAt: null },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { document: { select: { docNumber: true, title: true } } },
    }),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    holdersOf(ctx, "REVIEW"),
  ]);

  // Companies with people who can receive something — see recipientCompanies.
  const companies = await recipientCompanies(ctx);

  // Answering something: the question decides who this goes to. Whoever sent
  // it is addressed, the people copied in on the question are copied in on the
  // answer, and the subject carries the thread. All of it is editable — it is a
  // starting point, not a rule.
  const answering = sp.replyTo
    ? await db.transmittal.findUnique({
        where: { id: sp.replyTo },
        select: {
          id: true, number: true, subject: true, direction: true, issuingParty: true, createdById: true,
          recipients: { select: { userId: true, kind: true } },
        },
      })
    : null;
  const answerTo = answering
    ? answering.direction === "OUTGOING"
      // We sent it, so the answer comes back to whoever raised it.
      ? [answering.createdById]
      // It came from outside; the answer goes back to that company, and the
      // people it named are the ones who know about it.
      : answering.recipients.filter((one) => one.kind !== "CC" && one.userId).map((one) => one.userId!)
    : [];
  const answerCopies = answering
    ? answering.recipients.filter((one) => one.kind === "CC" && one.userId).map((one) => one.userId!)
    : [];

  // Completing or correcting something we sent: the new transmittal starts as a
  // copy of the first — its reason, its people, its documents — and the sender
  // changes what was missing. The first stays exactly as it went.
  const followKind = sp.kind === "REPLACES" ? "REPLACES" : "SUPPLEMENT";
  const following = sp.follows
    ? await db.transmittal.findFirst({
        where: { id: sp.follows, direction: "OUTGOING", NOT: { status: "DRAFT" } },
        select: {
          id: true, number: true, subject: true, reasonForIssue: true, status: true, rejectionReason: true,
          items: { select: { revisionId: true } },
          recipients: { select: { userId: true, partyId: true, kind: true } },
        },
      })
    : null;
  const idOf = (one: { userId: string | null; partyId: string | null }) => one.userId ?? (one.partyId ? `party:${one.partyId}` : null);
  const followTo = following ? following.recipients.filter((one) => one.kind !== "CC").map(idOf).filter((id): id is string => !!id) : [];
  const followCopies = following ? following.recipients.filter((one) => one.kind === "CC").map(idOf).filter((id): id is string => !!id) : [];

  const selectedDocumentIds = [...new Set([...(sp.docs ?? "").split(","), ...(sp.doc ? [sp.doc] : [])].map((value) => value.trim()).filter(Boolean))];
  const selectedDocuments = selectedDocumentIds.length ? await db.document.findMany({
    where: { id: { in: selectedDocumentIds } },
    include: { revisions: { where: { state: "RELEASED" }, orderBy: { releasedAt: "desc" }, take: 1 } },
  }) : [];
  const preselected = selectedDocuments.flatMap((document) => document.revisions[0]?.id ? [document.revisions[0].id] : []);

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
