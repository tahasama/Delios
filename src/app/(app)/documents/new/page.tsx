import { fieldRules, fieldLabels, ownFields } from "@/lib/field-policy";
import { getActiveSet } from "@/lib/config";
import { requireScope } from "@/lib/scope";
import { mayCreateDocument } from "@/lib/auth";
import { legacyNumbering } from "@/lib/api/admin";
import { Banner, PageHeader } from "@/components/ui";
import { NewDocumentForm } from "./new-document-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create document" };

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<{ received?: string; fromFile?: string; docType?: string; title?: string }> }) {
  const ctx = await requireScope();
  const { user, project } = ctx;
  const sp = await searchParams;
  const received = sp.received === "1" || !!sp.fromFile;
  // A file kept with a received transmittal, being made a register document.
  // The backend does not look a kept file up by its id (name, transmittal) yet.
  const kept = null as { id: string; name: string; transmittal: { number: string } | null } | null;
  const fromFile = kept ? { id: kept.id, name: kept.name, transmittal: kept.transmittal?.number ?? null } : undefined;
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
  const [fields, labels, own] = await Promise.all([fieldRules(ctx, "DOCUMENT"), fieldLabels(ctx, "DOCUMENT"), ownFields(ctx, "DOCUMENT")]);
  // Numbering and routes are read where Document Control keeps them; anybody
  // else gets none, and the backend still checks every value on submit.
  const { routing, schemes } = await legacyNumbering().catch(() => ({ routing: [], schemes: [] }));
  const routings = routing.filter((r) => r.status === "ACTIVE");
  const numberingSets: Record<string, string[]> = {};
  for (const r of routings) {
    const scheme = schemes.find((sc) => sc.name === r.schemeName);
    numberingSets[r.deliverableType] = (scheme?.fields ?? []).map((f) => f.valueSetKey).filter((k): k is string => !!k);
  }
  const defaultConf = confidentialities.find((c) => c.props.default === true)?.code ?? null;
  // A value's own one-line meaning travels with it, so the form can say what
  // "Restricted" or "Asset life" means where it is chosen.
  const toOpt = (rows: { code: string; label: string; props?: Record<string, unknown> }[]) => rows.map((r) => ({
    code: r.code,
    label: r.label,
    meaning: [r.props?.meaning, r.props?.basis, r.props?.may, r.props?.approval ? `approved by ${String(r.props.approval).toLowerCase()}` : null]
      .filter((x): x is string => typeof x === "string" && x.length > 0)[0] ?? null,
    // Who produces this kind of document, where the value says so.
    appliesTo: typeof r.props?.appliesTo === "string" ? r.props.appliesTo : null,
  }));
  const byName = (rows: { code: string; label: string; props?: Record<string, unknown> }[]) => toOpt(rows).sort((x, y) => x.label.localeCompare(y.label));

  return (
    <div>
      <PageHeader
        title={received ? "Receive a document" : "Create a document"}
        subtitle={received ? "Register what arrived and send it for approval in one go." : "The number is assigned when you finish."}
      />
      <NewDocumentForm
        fields={fields}
        labels={labels}
        ownFields={own}
        received={received}
        start={!received && sp.docType ? { docType: sp.docType, title: (sp.title ?? "").slice(0, 200) } : undefined}
        fromFile={fromFile}
        numberingSets={numberingSets}
        deliverableTypes={toOpt(deliverableTypes)}
        docTypes={byName(docTypes)}
        disciplines={byName(disciplines)}
        currentProject={{ code: project.code, name: project.name }}
        subprojects={toOpt(subprojects.filter((sp) => {
          // A sub-project belongs to one project when it says so; sets that name
          // none are shown whole, as before.
          const owner = sp.props.project ?? sp.props.projectCode;
          return typeof owner === "string" ? owner === project.code : true;
        }))}
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
