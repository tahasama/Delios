/**
 * The reference status tones (Schedule; docs/DETAIL-STYLE.md): every state chip in the app is one of these.
 * done: finished well · waiting: someone has to act · refused: stopped, sent back, not going ahead ·
 * idle: not yet open, or no longer in play · moving: under way.
 */
export const TONE = {
  done: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  waiting: "bg-amber-50 text-amber-900 ring-amber-200",
  refused: "bg-red-50 text-red-800 ring-red-200",
  idle: "bg-slate-100 text-slate-600 ring-slate-200",
  moving: "bg-sky-50 text-sky-800 ring-sky-200",
} as const;
