import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { addPackageMemberAction } from "@/lib/actions/planning";
import { getActiveSet } from "@/lib/config";
import { fmtDate } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add to package" };

/** One document or a selection from the register, into an open delivery package. */
export default async function AddToPackagePage({ searchParams }: { searchParams: Promise<{ docs?: string }> }) {
  const { db } = await requireScope();
  const ids = ((await searchParams).docs ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const [docs, packages, statuses] = await Promise.all([
    db.document.findMany({ where: { id: { in: ids } }, orderBy: { docNumber: "asc" }, select: { id: true, docNumber: true, title: true } }),
    // Supplier packages fill themselves; schedule packages come from the requirements list.
    db.package.findMany({ where: { closedAt: null, category: "DELIVERY" }, orderBy: { completionDate: "asc" }, include: { members: { select: { documentId: true } } } }),
    getActiveSet("STATUSES"),
  ]);

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col-reverse gap-3 px-5 pt-6 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="plate-name min-w-0">Add to a delivery package</h1>
            <p className="plate-meta mt-2">{docs.length} document{docs.length === 1 ? "" : "s"}, each needed at the status you choose</p>
          </div>
          <Link href="/documents" className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"><ArrowLeft className="h-4 w-4" /> Documents</Link>
        </div>
      </section>
      <section className="register register-sheet register-sheet-open">
        <div className="border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6"><span className="stencil text-slate-600">Documents and package</span></div>
        <div className="px-5 py-4 sm:px-6">
        <ul className="mb-4 space-y-1 text-xs">
          {docs.map((d) => (
            <li key={d.id}><Link href={`/documents/${d.id}`} className="font-mono font-semibold text-brand-ink hover:underline">{d.docNumber}</Link> <span className="text-slate-500">{d.title}</span></li>
          ))}
        </ul>
        {!docs.length ? (
          <p className="text-sm text-slate-500">Select documents in the register first.</p>
        ) : !packages.length ? (
          <p className="text-sm text-amber-800">No delivery package is open. <Link href="/packages?category=DELIVERY" className="font-semibold underline">Create one</Link> first.</p>
        ) : (
          <ActionForm action={addPackageMemberAction} submitLabel={`Add ${docs.length} document${docs.length === 1 ? "" : "s"}`} size="sm" hidden={{ redirect: "1" }}>
            {docs.map((d) => <input key={d.id} type="hidden" name="documentId" value={d.id} />)}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Package" required>
                <select name="packageId" required className={inputCls} defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {packages.map((p) => {
                    const already = docs.filter((d) => p.members.some((m) => m.documentId === d.id)).length;
                    return <option key={p.id} value={p.id}>{p.identifier} — {p.recipientName}, due {fmtDate(p.completionDate)}{already ? ` (${already} already in it)` : ""}</option>;
                  })}
                </select>
              </Field>
              <Field label="Needed at status" required hint="what each must have reached for the package to be complete">
                <select name="requiredStatus" required className={inputCls} defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {statuses.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.label}</option>)}
                </select>
              </Field>
            </div>
          </ActionForm>
        )}
        </div>
      </section>
    </div>
  );
}
