import { getActiveSet } from "@/lib/config";
import { requireScope } from "@/lib/scope";
import { mayCreateDocument } from "@/lib/auth";
import { Banner, PageHeader } from "@/components/ui";
import { NewDocumentForm } from "./new-document-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create document" };

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<{ received?: string }> }) {
  const { user, db } = await requireScope();
  const received = (await searchParams).received === "1";
  if (!mayCreateDocument(user)) {
    return <div><PageHeader title="Create a document" /><Banner tone="warn" title={user.isInternal ? "Read-only access" : "External party access"}>{user.isInternal ? "Your current access is read-only. Document Control can grant a contribution role when needed." : "External parties do not create register entries. Document Control creates and assigns a placeholder to your organization; you can then contribute files and revisions to that controlled entry."}</Banner></div>;
  }
  const [deliverableTypes, docTypes, disciplines, projects, subprojects, suppliers, pos, criticalities, confidentialities, retentionClasses] = await Promise.all([
    getActiveSet("DELIVERABLE_TYPES"),
    getActiveSet("DOCUMENT_TYPES"),
    getActiveSet("DISCIPLINES"),
    getActiveSet("PROJECT_CODES"),
    getActiveSet("SUBPROJECTS"),
    getActiveSet("SUPPLIER_CODES"),
    getActiveSet("PURCHASE_ORDERS"),
    getActiveSet("CRITICALITY"),
    getActiveSet("CONFIDENTIALITY"),
    getActiveSet("RETENTION_CLASSES"),
  ]);
  // Which value sets each producer's numbering scheme needs, so the form can
  // mark exactly those fields as required instead of failing on submit.
  const [routings, schemes] = await Promise.all([
    db.schemeRouting.findMany({ where: { status: "ACTIVE" } }),
    db.scheme.findMany({ include: { fields: true } }),
  ]);
  const numberingSets: Record<string, string[]> = {};
  for (const r of routings) {
    const scheme = schemes.find((sc) => sc.name === r.schemeName);
    numberingSets[r.deliverableType] = (scheme?.fields ?? []).map((f) => f.valueSetKey).filter((k): k is string => !!k);
  }
  // Review routes, each described by who it goes to — people choose by that.
  const [templates, people] = await Promise.all([
    db.workflowTemplate.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    db.user.findMany({ select: { id: true, name: true } }),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const routes = templates.map((t) => {
    const steps = JSON.parse(t.steps) as { act: string; participantIds: string[] }[];
    return {
      id: t.id,
      name: t.name,
      isDefault: t.isDefault,
      path: steps.map((st) => `${st.act === "APPROVAL" ? "approve" : "review"}: ${st.participantIds.map((id) => nameOf.get(id) ?? "?").join(", ")}`).join(" → "),
    };
  });
  const defaultConf = confidentialities.find((c) => c.props.default === true)?.code ?? null;
  const toOpt = (rows: { code: string; label: string }[]) => rows.map((r) => ({ code: r.code, label: r.label }));
  const byName = (rows: { code: string; label: string }[]) => toOpt(rows).sort((x, y) => x.label.localeCompare(y.label));

  return (
    <div>
      <PageHeader
        title={received ? "Receive a document" : "Create a document"}
        subtitle={received ? "Register what arrived and send it for approval in one go." : "The number is assigned when you finish."}
      />
      <NewDocumentForm
        received={received}
        routes={routes}
        numberingSets={numberingSets}
        deliverableTypes={toOpt(deliverableTypes)}
        docTypes={byName(docTypes)}
        disciplines={byName(disciplines)}
        projects={toOpt(projects)}
        subprojects={toOpt(subprojects)}
        suppliers={toOpt(suppliers)}
        pos={toOpt(pos)}
        criticalities={toOpt(criticalities)}
        confidentialities={toOpt(confidentialities)}
        retentionClasses={toOpt(retentionClasses)}
        defaultConfidentiality={defaultConf}
      />
    </div>
  );
}
