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

  const ourOrganization = (await db.party.findFirst({ where: { isInternal: true }, select: { name: true } }))?.name ?? "Our organization";
  const [reasons, revisionRows, users, reviewers] = await Promise.all([
    getActiveSet("REASONS_FOR_ISSUE"),
    db.revision.findMany({
      where: { state: { in: ["RELEASED", "IN_PREPARATION", "IN_REVIEW"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { document: { select: { docNumber: true, title: true } } },
    }),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, include: { party: { select: { code: true, name: true, active: true } } } }),
    holdersOf(ctx, "REVIEW"),
  ]);

  // Companies with people who can receive something. A recipient is chosen, not
  // typed, so every name on a transmittal is an account that can open it.
  const companies = [...
    users.reduce((map, u) => {
      const key = u.party?.code ?? "US";
      const name = u.party?.name ?? ctx.project.name.split(" ")[0] ?? "Our organization";
      if (u.party && u.party.active === false) return map;
      const group = map.get(key) ?? { key, name: u.party ? name : ourOrganization, people: [] as { id: string; name: string; job: string | null }[] };
      group.people.push({ id: u.id, name: u.name, job: u.organization ?? null });
      map.set(key, group);
      return map;
    }, new Map<string, { key: string; name: string; people: { id: string; name: string; job: string | null }[] }>()).values(),
  ].sort((a, b) => (a.key === "US" ? -1 : b.key === "US" ? 1 : a.name.localeCompare(b.name)));

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
        companies={companies}
        ourOrganization={ourOrganization}
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
