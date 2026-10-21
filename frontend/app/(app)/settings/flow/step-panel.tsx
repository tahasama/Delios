import Link from "next/link";
import { cn } from "@/lib/core/utils";
import { AsReceivedWarning } from "@/components/as-received-warning";
import type { Stage } from "./stages";

/** A page or list a step reads, with its figure; unlinked for whoever does not open it. */
export type Tile = { title: string; figure: string; href: string; warn: boolean; opens: boolean };

/**
 * A step's panel, the same at both levels: what happens, who does it, how it works here (each answer changed in place),
 * where it is set up, and on the organization's level what projects may change of it.
 */
export function StepPanel({ stage, warn, acts, answers, tiles, below }: {
  stage: Stage;
  warn: boolean;
  /** The acts whose carrier is chosen, drawn as answers. */
  acts: React.ReactNode[];
  answers: React.ReactNode[];
  tiles: Tile[];
  /** What follows the answers (the organization's: what projects may change). */
  below?: React.ReactNode;
}) {
  const fixedWho = stage.who.filter((one): one is { title: string; by: string } => typeof one !== "string");
  return (
    <section className={cn("register register-sheet register-sheet-open border-l-[3px] border-l-(--rail)", stage.rail)}>
      <header className="border-b border-line bg-tint-soft px-5 py-3 sm:px-6">
        <h2 className="text-[15px] font-semibold text-slate-950">{stage.title}</h2>
        <p className="mt-0.5 text-[13px] leading-5 text-slate-600">{stage.text}</p>
        {warn ? <div className="mt-2"><AsReceivedWarning /></div> : null}
      </header>
      <div className="grid grid-cols-1 divide-y divide-line lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
        <div className="space-y-5 px-5 py-4 sm:px-6">
          <div>
            <h3 className="stencil mb-2 text-slate-500">Who does it</h3>
            <ul className="divide-y divide-line">
              {fixedWho.map((one) => (
                <li key={one.title} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
                  <span className="text-[13px] font-medium text-slate-900">{one.title}</span>
                  <span className="text-[13px] text-slate-700">{one.by}</span>
                </li>
              ))}
              {acts}
            </ul>
          </div>
          {answers.length ? (
            <div>
              <h3 className="stencil mb-2 text-slate-500">How it works here</h3>
              <ul className="divide-y divide-line">{answers}</ul>
            </div>
          ) : null}
          {below}
        </div>
        <div className="px-5 py-4 sm:px-6">
          <h3 className="stencil mb-2 text-slate-500">Set up in</h3>
          {tiles.length ? (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {tiles.map((one) => (
                <li key={one.href + one.title}>
                  {one.opens ? (
                    <Link href={one.href} className="flex h-full flex-col rounded-md bg-tint-soft px-3 py-2 ring-1 ring-line transition-shadow duration-300 ease-out hover:ring-brand-line">
                      <span className="text-[13px] font-medium text-link">{one.title}</span>
                      <span className={cn("text-xs", one.warn ? "text-amber-800" : "text-slate-600")}>{one.figure}</span>
                    </Link>
                  ) : (
                    <div className="flex h-full flex-col rounded-md bg-tint-soft px-3 py-2 ring-1 ring-line">
                      <span className="text-[13px] font-medium text-slate-800">{one.title}</span>
                      <span className={cn("text-xs", one.warn ? "text-amber-800" : "text-slate-600")}>{one.figure}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-600">Nothing of its own: it works from what the steps before it set.</p>
          )}
        </div>
      </div>
    </section>
  );
}
