import { requireScope } from "@/lib/core/scope";
import { PageHeader } from "@/components/ui";
import { AssuranceTabs } from "@/app/(app)/conformance/tabs";
import { PrintButton } from "@/app/(app)/conformance/statement/print-button";
import { DocumentManagementPlan, CHAPTERS } from "./plan";

export const dynamic = "force-dynamic";
export const metadata = { title: "The plan" };

/**
 * The project's document management plan: a document, not a setting. Everyone of ours reads it (Assurance is ours
 * only); the backend gathers what only the keepers read elsewhere (`GET /plan`). The contents stay beside it on screen.
 */
export default async function PlanPage() {
  await requireScope();
  return (
    <div className="space-y-4">
      <div className="no-print">
        <PageHeader
          title="The plan"
          subtitle="How documents are controlled on this project: how each thing is done, why, by whom, where and when. Written from how the project is set up, so it is always true."
          actions={<PrintButton />}
        />
        <AssuranceTabs current="/conformance/plan" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_240px]">
        <DocumentManagementPlan />
        <aside className="no-print hidden xl:block">
          <nav aria-label="Contents" className="register register-sheet register-sheet-open sticky top-20">
            <p className="border-b border-line bg-tint-soft px-4 py-2.5"><span className="stencil text-slate-500">Contents</span></p>
            <ol className="space-y-0.5 px-2 py-2">
              {CHAPTERS.map((c, i) => (
                <li key={c.id}>
                  <a href={`#${c.id}`} className="flex gap-2 rounded-sm px-2 py-1 text-[12px] leading-5 text-slate-600 hover:bg-tint-soft hover:text-slate-900">
                    <span className="w-4 shrink-0 text-right font-mono text-[11px] text-slate-400">{i + 1}</span>
                    <span>{c.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>
      </div>
    </div>
  );
}
