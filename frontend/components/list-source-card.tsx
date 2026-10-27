import Link from "next/link";
import { FileText } from "lucide-react";
import { cn } from "@/lib/core/utils";
import { chooseHref, type ListSource } from "@/lib/actions/list-source-kinds";

/**
 * Where a list comes from (owner: "make it more visible"), the same card on the Schedule and on Import & export: its
 * register document, chosen by the control function in the register (until then the one the app finds by its type, said
 * so in amber), its released revision, and what it was read from last; the latest stands. Its side colour says where it
 * stands: released (emerald), nothing released yet (amber), none chosen (grey).
 */
export function ListSourceCard({ source, children, newer }: { source: ListSource; children?: React.ReactNode; newer?: string | null }) {
  const doc = source.document;
  const last = source.last;
  const day = (at: string) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const rail = !doc || doc.chosenByApp ? "rail-none" : doc.releasedValue ? "rail-released" : "rail-prep";
  return (
    <section className={cn("register register-sheet register-sheet-open border-l-[3px] border-l-(--rail)", rail)} aria-label={`Where the ${source.title.toLowerCase()} comes from`}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-4 py-3">
        <div className="min-w-0 space-y-1">
          <p className="stencil text-slate-500">Its register document</p>
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <FileText className="h-4 w-4 shrink-0 self-center text-slate-500" aria-hidden="true" />
            {doc ? (
              <>
                <Link href={`/documents/${doc.id}`} className="font-mono font-semibold text-brand-ink hover:underline">{doc.number}</Link>
                <span className="min-w-0 truncate text-slate-700">{doc.title}</span>
                <span className={cn("text-xs font-semibold", doc.releasedValue ? "text-emerald-700" : "text-amber-800")}>
                  {doc.releasedValue ? `released: rev ${doc.releasedValue}` : "nothing released yet"}
                </span>
              </>
            ) : <span className="font-semibold text-slate-600">None chosen yet</span>}
          </p>
          {doc?.chosenByApp ? <p className="text-xs text-amber-800">Found by its type, not chosen yet: the control function chooses it in the register.</p> : null}
          <p className="text-xs text-slate-600">
            {last
              ? <>Read last from {last.from === "DOCUMENT" ? <strong className="font-semibold">its register document{last.label ? `, ${last.label}` : ""}</strong> : <strong className="font-semibold">a file uploaded{last.label ? ` (${last.label})` : ""}</strong>}{last.at ? `, ${day(last.at)}` : ""}{last.byName ? ` by ${last.byName}` : ""}. The latest stands.</>
              : "Not read yet. It comes from its register document's released revision or from a file uploaded: the latest stands."}
          </p>
          {newer ? <p className="text-xs font-semibold text-amber-800">{newer}</p> : null}
        </div>
        {source.mayChoose ? (
          <Link href={chooseHref(source.kind, source.where)} className="ask shrink-0" data-on="true">
            {doc && !doc.chosenByApp ? "Choose another in the register" : "Choose it in the register"}
          </Link>
        ) : null}
      </div>
      {children ? <div className="border-t border-line px-4 py-3">{children}</div> : null}
    </section>
  );
}
