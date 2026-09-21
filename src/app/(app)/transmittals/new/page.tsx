import { PageHeader } from "@/components/ui";
import { requireScope } from "@/lib/scope";
import { getActiveSet } from "@/lib/config";
import { NewTransmittalForm } from "./new-transmittal-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New transmittal" };

export default async function NewTransmittalPage({ searchParams }: { searchParams: Promise<{ doc?: string; docs?: string; direction?: string }> }) {
  const { db } = await requireScope();
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
    db.user.findMany({ where: { role: { in: ["REVIEWER", "APPROVER", "ADMIN", "CONTROLLER"] }, active: true }, orderBy: { name: "asc" } }),
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
        reviewers={reviewers.map((u) => ({ id: u.id, name: u.name, role: u.role }))}
        defaultDirection={sp.direction === "INCOMING" ? "INCOMING" : "OUTGOING"}
        preselectedRevisionIds={preselected}
      />
    </div>
  );
}
