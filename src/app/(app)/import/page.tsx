
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, ButtonLink } from "@/components/ui";
import { BulkImportForm } from "./bulk-import-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bulk import & export" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { db } = await requireScope();
  const sp = await searchParams;

  const exports = [
    { kind: "documents", label: "Master register (all states)" },
    { kind: "baseline", label: "Actions & deliverable baseline" },
    { kind: "packages", label: "Packages & membership" },
    { kind: "transmittals", label: "Transmittals" },
    { kind: "defects", label: "Defect register" },
    { kind: "checks", label: "Latest conformance results" },
    { kind: "audit", label: "Audit trail (last 5000 events)" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bulk import & export"
        subtitle="Bring in a deliverable list or correct many documents at once, with every row checked before anything is committed."
        actions={<ButtonLink href="/documents" variant="secondary">Back to register</ButtonLink>}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <BulkImportForm initialKind={sp.kind ?? ""} />

        <div className="space-y-4">
          <Card title="Templates" description="Download, fill the rows, keep the header.">
            <ul className="space-y-2 text-sm">
              <li><a href="/api/export/template-deliverables" className="font-medium text-brand-ink hover:underline">Deliverable list template</a></li>
              <li className="hidden"><a href="/api/export/template-baseline">Baseline template</a></li>
              <li><a href="/api/export/template-metadata" className="font-medium text-brand-ink hover:underline">Metadata update template</a></li>
              <li><a href="/api/export/template-people" className="font-medium text-brand-ink hover:underline">People template</a></li>
            </ul>
          </Card>
          <Card title="Extract any view" description="Each file carries its generation timestamp.">
            <ul className="space-y-2 text-sm">
              {exports.map((e) => (
                <li key={e.kind}>
                  <a href={`/api/export/${e.kind}`} className="font-medium text-brand-ink hover:underline">{e.label} ↓</a>
                </li>
              ))}
            </ul>
                      </Card>
        </div>
      </div>
    </div>
  );
}
