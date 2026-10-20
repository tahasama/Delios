/**
 * How each state of a document reads, once for every place that shows it (owner: never two states of the same register
 * in the same colour; "In preparation" and "Accepted" were both amber). A revision's states and a supplier's stages share
 * one map: the register shows whichever applies in the same column, so each has its own hue, and a state meaning the
 * same in both (in review, released) reads the same. `ink` is the register's coloured text, `rail` its side colour (as
 * the key on Help), `pill` its chip outside registers.
 */
export type StateLook = { ink: string; rail: string; pill: string };

export const STATE_LOOK: Record<string, StateLook> = {
  NONE: { ink: "text-slate-500", rail: "rail-none", pill: "bg-slate-100 text-slate-600 ring-slate-200" },
  IN_PREPARATION: { ink: "text-amber-700", rail: "rail-prep", pill: "bg-amber-50 text-amber-800 ring-amber-200" },
  IN_REVIEW: { ink: "text-sky-700", rail: "rail-review", pill: "bg-sky-50 text-sky-800 ring-sky-200" },
  NOT_RELEASED: { ink: "text-indigo-700", rail: "rail-issue", pill: "bg-indigo-50 text-indigo-800 ring-indigo-200" },
  RETURNED: { ink: "text-rose-700", rail: "rail-rejected", pill: "bg-rose-50 text-rose-800 ring-rose-200" },
  RELEASED: { ink: "text-emerald-700", rail: "rail-released", pill: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  SUPERSEDED: { ink: "text-violet-700", rail: "rail-superseded", pill: "bg-violet-50 text-violet-800 ring-violet-200" },
  VOID: { ink: "text-red-700", rail: "rail-void", pill: "bg-red-50 text-red-800 ring-red-200" },
  // A supplier's document, in its own stages.
  SENT: { ink: "text-blue-700", rail: "rail-sent", pill: "bg-blue-50 text-blue-800 ring-blue-200" },
  RECEIVED: { ink: "text-cyan-700", rail: "rail-check", pill: "bg-cyan-50 text-cyan-800 ring-cyan-200" },
  // Let in by the check: only the first step of a long way, so never a green that reads as approved or released (owner).
  ACCEPTED: { ink: "text-fuchsia-700", rail: "rail-checked", pill: "bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200" },
  RETURNED_CHECK: { ink: "text-orange-700", rail: "rail-returned", pill: "bg-orange-50 text-orange-800 ring-orange-200" },
  RETURNED_REVIEW: { ink: "text-rose-700", rail: "rail-rejected", pill: "bg-rose-50 text-rose-800 ring-rose-200" },
};

/** The look of a state, by its code (a supplier's stage first, when the document was asked of one). */
export function stateLook(code: string | null | undefined): StateLook {
  return STATE_LOOK[code ?? "NONE"] ?? STATE_LOOK.NONE;
}

/** Where a state is explained: its own line on Help, lit when opened (`/guide#state-<code>`). */
export function stateHref(code: string): string {
  return `/guide#state-${code}`;
}
