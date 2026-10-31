import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { ToneChip } from "@/components/ui";
import { TONE } from "@/lib/core/tones";
import { cn } from "@/lib/core/utils";

/**
 * The pieces the document management plan is set in, in the reference style (docs/DETAIL-STYLE.md): each chapter a
 * sheet with its band; inside it, why it exists, how it is done (who, what, when), the facts it runs on, and what the
 * app makes sure of. "Change this" leads to where it is set, on screen only.
 */

/** One chapter: a numbered sheet, its band saying what it is and why. */
export function Chapter({ n, id, title, why, change, children }: {
  n: number; id: string; title: string; why: string; change?: { href: string; label: string }[]; children: React.ReactNode;
}) {
  return (
    <section id={id} className="plan-chapter register register-sheet register-sheet-open scroll-mt-24">
      <header className="border-b border-line bg-tint-soft px-5 py-3 sm:px-6">
        <p className="stencil text-slate-500">Chapter {n}</p>
        <h2 className="mt-0.5 text-[17px] font-semibold tracking-tight text-slate-900">{title}</h2>
        <p className="mt-1 max-w-3xl text-[12.5px] leading-5 text-slate-600">{why}</p>
      </header>
      <div className="space-y-5 px-5 py-5 sm:px-6">{children}</div>
      {change?.length ? (
        <p className="no-print flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">
          <span>Set in</span>
          {change.map((one) => (
            <Link key={one.href} href={one.href} className="inline-flex items-center gap-1 font-semibold text-link hover:underline">
              {one.label}<ArrowUpRight className="h-3 w-3" />
            </Link>
          ))}
        </p>
      ) : null}
    </section>
  );
}

/** A titled part of a chapter. */
export function Part({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="plan-part space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-brand-ink"><span aria-hidden className="h-3.5 w-[3px] rounded-full bg-brand-ink/40" />{title}</h3>
        {aside ? <span className="text-[11px] text-slate-500">{aside}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** Plain text of the plan. */
export function Say({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("max-w-3xl text-[13px] leading-[1.6] text-slate-700", className)}>{children}</p>;
}

export type Step = {
  /** What is done, in a few words. */
  what: React.ReactNode;
  /** Who does it. */
  who?: React.ReactNode;
  /** When, or how long it has. */
  when?: React.ReactNode;
  /** More about it, a sentence or two. */
  detail?: React.ReactNode;
  /** The side colour of the state it leads to (lib/core/rails.ts). */
  rail?: string;
};

/** How something is done: numbered steps down a line, each saying what, who and when. */
export function Flow({ steps }: { steps: Step[] }) {
  return (
    <ol className="plan-flow relative space-y-0">
      {steps.map((step, i) => (
        <li key={i} className={cn("relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 pb-3.5 last:pb-0", step.rail ?? "rail-none")}>
          {i < steps.length - 1 ? <span aria-hidden className="absolute top-7 bottom-0 left-[0.8125rem] w-px bg-line" /> : null}
          <span aria-hidden className="relative z-[1] grid h-7 w-7 place-items-center rounded-full bg-surface text-[11px] font-bold text-slate-700 ring-2 ring-(--rail)">{i + 1}</span>
          <div className="min-w-0 pt-1">
            <p className="text-[13px] font-semibold leading-5 text-slate-900">{step.what}</p>
            {step.who || step.when ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-5 text-slate-600">
                {step.who ? <span><span className="text-slate-500">Who · </span><span className="font-medium text-slate-800">{step.who}</span></span> : null}
                {step.when ? <span><span className="text-slate-500">When · </span>{step.when}</span> : null}
              </p>
            ) : null}
            {step.detail ? <p className="mt-0.5 max-w-3xl text-[12px] leading-5 text-slate-500">{step.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Facts, one per line: what it is, and its value. */
export function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-line rounded-md ring-1 ring-line">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-1 gap-1 px-3.5 py-2 text-[13px] sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
          <dt className="text-xs font-semibold text-brand-ink/80">{label}</dt>
          <dd className="min-w-0 text-slate-800">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A small table: its head, then its rows. */
export function Grid({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty?: React.ReactNode }) {
  if (!rows.length) return <Missing>{empty ?? "None yet."}</Missing>;
  return (
    <div className="overflow-x-auto rounded-md ring-1 ring-line">
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-line bg-tint">
            {head.map((h) => <th key={h} className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-brand-ink/80">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, i) => (
            <tr key={i} className="align-top even:bg-tint-soft/60">
              {row.map((cell, j) => <td key={j} className={cn("px-3 py-2 text-slate-800", j === 0 && "font-medium text-brand-ink")}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A code, as it appears in numbers and lists. */
export function Code({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11.5px] font-semibold text-slate-900">{children}</span>;
}

/** Something not set up yet, said where it belongs, with what it means. */
export function Missing({ children }: { children: React.ReactNode }) {
  return <p className={cn("w-fit rounded-md px-2.5 py-1 text-[12px] ring-1", TONE.waiting)}>{children}</p>;
}

/** What the app makes sure of: refused at the moment somebody tries, on every project. */
export function Ensured({ rules }: { rules: { condition: string; prevented: string }[] }) {
  if (!rules.length) return null;
  return (
    <div className="plan-part rounded-md bg-emerald-50/50 px-3.5 py-3 ring-1 ring-emerald-200 dark:bg-emerald-950/20">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-emerald-800 dark:text-emerald-300">
        <ShieldCheck className="h-3.5 w-3.5" /> The app makes sure of it
      </p>
      <ul className="mt-1.5 space-y-1">
        {rules.map((rule) => (
          <li key={rule.condition} className="text-[12px] leading-5 text-slate-700">
            <span className="font-medium text-slate-900">Never: {rule.condition.charAt(0).toLowerCase() + rule.condition.slice(1)}.</span> {rule.prevented}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Rules that always hold, short and checkable. */
export function Always({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
      {items.map((item, i) => (
        <li key={i} className="relative pl-4 text-[12.5px] leading-5 text-slate-700 before:absolute before:top-2 before:left-0 before:h-1.5 before:w-1.5 before:rounded-full before:bg-brand-ink">
          {item}
        </li>
      ))}
    </ul>
  );
}

export { ToneChip };
