import Link from "next/link";
import { FileCheck2, Link2 } from "lucide-react";
import { ActionForm } from "@/components/form";
import { inputCls } from "@/components/ui";
import { linkControlledSourceAction } from "@/lib/actions/controlled-source";
import { fmtDate } from "@/lib/utils";

type Source = { id: string; value: string; state: string; statusCode: string | null; releasedAt: Date | null; document: { id: string; docNumber: string; title: string } } | null;
type Option = { id: string; value: string; state: string; document: { docNumber: string; title: string } };

export function ControlledSource({ label, sourceType, sourceId, returnPath, source, options, canLink }: { label: string; sourceType: string; sourceId: string; returnPath: string; source: Source; options: Option[]; canLink: boolean }) {
  return <section className={`rounded-2xl border px-5 py-4 ${source ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-sm ${source ? "text-emerald-700" : "text-amber-700"}`}>{source ? <FileCheck2 className="h-5 w-5" /> : <Link2 className="h-5 w-5" />}</span><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Controlled {label}</p>{source ? <><Link href={`/documents/${source.document.id}`} className="mt-1 block font-mono text-sm font-bold text-[#315f83] hover:underline">{source.document.docNumber} · rev {source.value}</Link><p className="mt-1 text-xs text-slate-600">{source.document.title} · {source.state.replaceAll("_", " ").toLowerCase()}{source.statusCode ? ` at ${source.statusCode}` : ""}{source.releasedAt ? ` · released ${fmtDate(source.releasedAt)}` : ""}</p></> : <><p className="mt-1 text-sm font-semibold text-amber-900">No controlled document revision is linked</p><p className="mt-1 text-xs text-amber-800/75">The functional view works, but its governing file and formal approval are not yet traceable.</p></>}</div></div>
      {canLink && options.length ? <details className="min-w-72 rounded-xl border border-white/70 bg-white/70"><summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-[#315f83]">{source ? "Change linked revision" : "Link controlled revision"}</summary><div className="border-t border-slate-100 p-3"><ActionForm action={linkControlledSourceAction} submitLabel="Save link" size="sm" hidden={{ sourceType, sourceId, returnPath }}><select name="revisionId" required defaultValue={source?.id ?? ""} className={inputCls}><option value="" disabled>Select document revision…</option>{options.map((option) => <option key={option.id} value={option.id}>{option.document.docNumber} rev {option.value} · {option.state.toLowerCase()}</option>)}</select></ActionForm></div></details> : !source ? <Link href="/documents/new" className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-[#315f83] shadow-sm">Create the controlled document</Link> : null}
    </div>
  </section>;
}
