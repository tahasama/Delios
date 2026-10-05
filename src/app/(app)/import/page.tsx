
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, ButtonLink } from "@/components/ui";
import { Download } from "lucide-react";
import { BulkImportForm } from "./bulk-import-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bulk import & export" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const ctx = await requireScope();
  const { db } = ctx;
  const sp = await searchParams;

  // Everything on this page changes the project wholesale — a register, a team,
  // the matrix, a published list. Creating a document does not qualify someone
  // to create accounts, so custody or configuration is the bar.
  if (!ctx.can("CONTROL") && !ctx.can("CONFIGURE")) {
    return <PageHeader title="Bulk import & export" subtitle={ctx.why("CONTROL")} />;
  }


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
        subtitle="Bring a list in, or take one out. Every row is checked and shown to you before anything is written."
        actions={<ButtonLink href="/documents" variant="secondary">Back to register</ButtonLink>}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <BulkImportForm initialKind={sp.kind ?? ""} />

        <div className="space-y-4">
          <Card title="Take a copy out" description="Any register, as it stands. Each file carries the moment it was made.">
            <ul className="-mx-2 text-sm">
              {exports.map((e) => (
                <li key={e.kind}>
                  <a
                    href={`/api/export/${e.kind}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-slate-700 transition hover:bg-slate-50 hover:text-brand-ink"
                  >
                    <span className="min-w-0 text-[13px]">{e.label}</span>
                    <Download className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
