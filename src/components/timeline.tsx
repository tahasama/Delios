import { fmtDateTime } from "@/lib/utils";

export type TimelinePoint = {
  /** What happened, in the fewest words that stay true. */
  label: string;
  /** When it happened; null means it has not happened yet. */
  at?: Date | null;
  /** Who did it, or who it waits on. */
  holder?: string | null;
  /** Anything worth reading under the point — a reason, a figure, a list. */
  detail?: React.ReactNode;
  /** A point that cannot happen any more, e.g. a step the route skipped. */
  skipped?: boolean;
  /** The point the reader is looking at, marked so they can find themselves. */
  here?: boolean;
  /** A heading above this point, for a run of points that belong together. */
  group?: string;
};

/**
 * The one way this app draws a process: a vertical line, one point per step,
 * done points filled and future points hollow. A review, an activity, a
 * transmittal and a package are all a sequence of dated acts, so they are all
 * read the same way and nobody has to learn a second shape.
 */
export function Timeline({ points, className }: { points: TimelinePoint[]; className?: string }) {
  return (
    <ol className={`relative ml-2 space-y-4 border-l border-slate-200 pl-5 ${className ?? ""}`}>
      {points.map((point, i) => [
        // A heading is a row of its own, so it never sits on the rail where a
        // dot belongs.
        point.group && point.group !== points[i - 1]?.group ? (
          <li key={`group-${i}`} className="relative -mb-1 list-none pt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            {point.group}
          </li>
        ) : null,
        <li key={`${point.label}-${i}`} className={point.here ? "relative rounded-lg bg-tint px-2.5 py-2 ring-1 ring-brand-line/30" : "relative"}>
          <span
            aria-hidden
            className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ${
              point.here ? "bg-brand-strong ring-4 ring-tint" : point.skipped ? "border-2 border-slate-200 bg-slate-100" : point.at ? "bg-emerald-500" : "border-2 border-slate-300 bg-surface"
            }`}
          />
          <p className={`text-xs font-semibold ${point.here ? "text-brand-ink" : point.at ? "text-slate-800" : "text-slate-500"}`}>
            {point.label}
            {point.here ? <span className="ml-2 rounded-md bg-tint px-1.5 py-0.5 text-[10px] font-semibold text-brand-ink">you are here</span> : null}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {point.skipped ? "not part of this route" : point.at ? fmtDateTime(point.at) : "not yet"}
            {point.holder ? ` · ${point.holder}` : ""}
          </p>
          {point.detail ? <div className="mt-1 text-[11px] text-slate-600">{point.detail}</div> : null}
        </li>,
      ])}
    </ol>
  );
}
