/**
 * The reference status tones (Schedule; docs/DETAIL-STYLE.md): every state chip in the app is one of these.
 * done: finished well · waiting: someone has to act · refused: stopped, sent back, not going ahead ·
 * idle: not yet open, or no longer in play · moving: under way.
 * An outline in the tone with the lightest wash of it inside: read at a glance, never a block of colour.
 */
export const TONE = {
  done: "bg-emerald-50/40 text-emerald-800 ring-emerald-300",
  waiting: "bg-amber-50/40 text-amber-900 ring-amber-300",
  refused: "bg-red-50/40 text-red-800 ring-red-300",
  idle: "bg-slate-50/40 text-slate-600 ring-slate-300",
  moving: "bg-sky-50/40 text-sky-800 ring-sky-300",
} as const;
