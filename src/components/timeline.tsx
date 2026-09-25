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
      {points.map((point, i) => (
        <li key={`${point.label}-${i}`} className="relative">
          <span
            aria-hidden
            className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ${
              point.skipped ? "border-2 border-slate-200 bg-slate-100" : point.at ? "bg-emerald-500" : "border-2 border-slate-300 bg-surface"
            }`}
          />
          <p className={`text-xs font-semibold ${point.at ? "text-slate-800" : "text-slate-500"}`}>{point.label}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {point.skipped ? "not part of this route" : point.at ? fmtDateTime(point.at) : "not yet"}
            {point.holder ? ` · ${point.holder}` : ""}
          </p>
          {point.detail ? <div className="mt-1 text-[11px] text-slate-600">{point.detail}</div> : null}
        </li>
      ))}
    </ol>
  );
}
