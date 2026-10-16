import Link from "next/link";
import { notFound } from "next/navigation";
import { requireScope } from "@/lib/core/scope";
import { ActionForm } from "@/components/form";
import { SearchPick } from "@/components/search-pick";
import { addDocumentToActionAction } from "@/lib/actions/forms-links";
import { activityList } from "@/lib/actions/api";
import { documentsByIds } from "@/lib/packages/api";
import { getActiveSet } from "@/lib/settings/config";
import { fmtDate } from "@/lib/core/utils";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add to action" };

/**
 * A selection from the register, added to one schedule action for one of its
 * disciplines: the numbers only, as the requirements list does when it says
 * nothing of status or date. The control function.
 */
export default async function AddToActionPage({ searchParams }: { searchParams: Promise<{ docs?: string }> }) {
  const ctx = await requireScope();
  if (!ctx.can("CONTROL")) notFound();
  const ids = ((await searchParams).docs ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const [docs, actions, disciplines] = await Promise.all([documentsByIds(ctx, ids), activityList(ctx), getActiveSet("DISCIPLINES")]);
  const label = (code: string) => disciplines.find((d) => d.code === code)?.label ?? code;
  // Only actions that concern a discipline can need a document.
  const tagged = actions.filter((a) => a.departments.length).sort((a, b) => a.code.localeCompare(b.code));

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col-reverse gap-3 px-5 pt-6 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="plate-name min-w-0">Add to a schedule action</h1>
            <p className="plate-meta mt-2">{docs.length} document{docs.length === 1 ? "" : "s"}, each for its own discipline</p>
          </div>
          <Link href="/documents" className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Documents</Link>
        </div>
      </section>
      <section className="register register-sheet register-sheet-open">
        <div className="border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6"><span className="stencil text-slate-600">Documents and action</span></div>
        <div className="px-5 py-4 sm:px-6">
          <ul className="mb-4 space-y-1 text-xs">
            {docs.map((d) => (
              <li key={d.id}><Link href={`/documents/${d.id}`} className="font-mono font-semibold text-brand-ink hover:underline">{d.docNumber}</Link> <span className="text-slate-500">{d.title}</span></li>
            ))}
          </ul>
          {!docs.length ? (
            <p className="text-sm text-slate-500">Select documents in the register first.</p>
          ) : !tagged.length ? (
            <p className="text-sm text-amber-800">No action concerns a discipline yet. Tag the disciplines on an action first.</p>
          ) : (
            <ActionForm action={addDocumentToActionAction} submitLabel={`Add ${docs.length} document${docs.length === 1 ? "" : "s"}`} size="sm" hidden={{ back: "1" }}>
              {docs.map((d) => <input key={d.id} type="hidden" name="documentIds" value={d.id} />)}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SearchPick
                  single
                  browse
                  required
                  name="actionId"
                  label="Action"
                  placeholder="Type a number or a name"
                  items={tagged.map((a) => ({ id: a.id, name: `${a.code} · ${a.name}`, detail: [a.start ? fmtDate(a.start) : null, a.departments.map(label).join(", ")].filter(Boolean).join(" · ") }))}
                />
                <p className="self-end text-[11px] text-slate-500">Each document is needed for its own discipline: the action must concern it.</p>
              </div>
            </ActionForm>
          )}
        </div>
      </section>
    </div>
  );
}
