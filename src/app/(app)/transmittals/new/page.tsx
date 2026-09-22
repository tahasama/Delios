import { PageHeader } from "@/components/ui";
import { requireScope } from "@/lib/scope";
import { getActiveSet } from "@/lib/config";
import { holdersOf } from "@/lib/permissions";
import { NewTransmittalForm } from "./new-transmittal-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New transmittal" };

type Search = { doc?: string; docs?: string; direction?: string; revisions?: string; users?: string; to?: string; reason?: string; party?: string; subject?: string; message?: string };

export default async function NewTransmittalPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireScope();
  const { db } = ctx;
  const sp = await searchParams;

  const [reasons, revisionRows, users, reviewers] = await Promise.all([
    getActiveSet("REASONS_FOR_ISSUE"),
    db.revision.findMany({
      where: { state: { in: ["RELEASED", "IN_PREPARATION", "IN_REVIEW"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { document: { select: { docNumber: true, title: true } } },
    }),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    holdersOf(ctx, "REVIEW"),
  ]);

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
      />
      <NewTransmittalForm
        reasons={reasons.map((r) => ({ code: r.code, label: r.label, props: r.props }))}
        revisions={revisionRows.map((r) => ({ id: r.id, label: `${r.document.docNumber} rev ${r.value}${r.statusCode ? ` · ${r.statusCode}` : ""} — ${r.document.title.slice(0, 50)}`, released: r.state === "RELEASED" }))}
        users={users.map((u) => ({ id: u.id, name: u.name, role: u.role }))}
        reviewers={reviewers.map((u) => ({ id: u.id, name: u.name, role: u.functionName }))}
        defaultDirection={sp.direction === "INCOMING" ? "INCOMING" : "OUTGOING"}
        preselectedRevisionIds={preselected}
        prefill={{
          revisionIds: (sp.revisions ?? "").split(",").filter(Boolean),
          userIds: (sp.users ?? "").split(",").filter(Boolean),
          outsiders: sp.to, reason: sp.reason, party: sp.party, subject: sp.subject, message: sp.message,
        }}
      />
    </div>
  );
}
