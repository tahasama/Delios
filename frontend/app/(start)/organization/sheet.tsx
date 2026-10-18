/** The organization's sheets: a band (what it is, the sentence about it, its way to where it is changed), then its body. */
export function Sheet({ id, title, note, act, tone, children, foot }: {
  id?: string; title: string; note?: React.ReactNode; act?: React.ReactNode; tone?: "waiting"; children: React.ReactNode; foot?: React.ReactNode;
}) {
  return (
    <section id={id} className={`register register-sheet register-sheet-open scroll-mt-24 ${tone === "waiting" ? "ring-1 ring-amber-200" : ""}`}>
      <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-line px-5 py-2.5 sm:px-6 ${tone === "waiting" ? "bg-amber-50" : "bg-tint-soft"}`}>
        <span className={`stencil mr-1 ${tone === "waiting" ? "text-amber-900" : "text-slate-500"}`}>{title}</span>
        {note ? <span className="text-[11px] text-slate-500">{note}</span> : null}
        {act ? <span className="ml-auto">{act}</span> : null}
      </div>
      {children}
      {foot ? <p className="border-t border-line px-5 py-2.5 text-[11px] text-slate-500 sm:px-6">{foot}</p> : null}
    </section>
  );
}
