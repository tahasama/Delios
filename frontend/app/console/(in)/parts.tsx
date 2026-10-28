import { cn } from "@/lib/core/utils";

/** A page's plate in the console, the organization's way: title, a line, its acts on the right, then its figures. */
export function Plate({ title, meta, acts, figures }: {
  title: string; meta?: React.ReactNode; acts?: React.ReactNode;
  figures?: { term: string; value: React.ReactNode; said?: React.ReactNode; tone?: string }[];
}) {
  return (
    <header className="register register-sheet register-sheet-open">
      <div className="flex flex-col gap-4 px-5 pt-5 pb-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h1 className="plate-title text-slate-950">{title}</h1>
          {meta ? <p className="plate-meta mt-1.5 max-w-2xl font-normal">{meta}</p> : null}
        </div>
        {acts ? <div className="flex shrink-0 flex-wrap items-center gap-2">{acts}</div> : null}
      </div>
      {figures?.length ? (
        <dl className={cn("grid grid-cols-2 gap-px border-t border-line bg-line", figures.length >= 4 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
          {figures.map((f) => (
            <div key={f.term} className="bg-surface px-5 py-3 sm:px-6">
              <dt className="stencil text-slate-500">{f.term}</dt>
              <dd className={cn("mt-1 text-[13px] font-medium tabular-nums text-slate-900", f.tone)}>{f.value}</dd>
              {f.said ? <dd className="text-[11px] text-slate-500">{f.said}</dd> : null}
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  );
}

/** A sheet's head band: its name, a line, anything acting on all of it. */
export function Band({ title, said, children }: { title: string; said?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
      <span className="stencil mr-1 text-slate-500">{title}</span>
      {said ? <span className="text-[11px] text-slate-500">{said}</span> : null}
      {children ? <span className="ml-auto flex items-center gap-2">{children}</span> : null}
    </div>
  );
}

/** A sheet of the page, with its band. */
export function Sheet({ title, said, acts, children, id, className }: {
  title: string; said?: React.ReactNode; acts?: React.ReactNode; children: React.ReactNode; id?: string; className?: string;
}) {
  return (
    <section id={id} className={cn("register register-sheet register-sheet-open scroll-mt-24", className)}>
      <Band title={title} said={said}>{acts}</Band>
      {children}
    </section>
  );
}

/** A plain line when a list holds nothing. */
export function Nothing({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-4 text-[13px] text-slate-500 sm:px-6">{children}</p>;
}

/** The red mark of what a lawyer still has to give (owner: "mark in red that this should be a legal thing"). */
export function LawyerMark({ children }: { children: React.ReactNode }) {
  return <span className="rounded-sm border border-dashed border-red-400 bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-200">{children}</span>;
}
