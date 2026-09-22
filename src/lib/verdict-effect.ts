export type ChoiceOption = { value: string; label: string; sets: Record<string, unknown> };

/**
 * What a review verdict does, asked once. Stored as the Standard's two
 * consequences (§9.3), which the rest of the app reads:
 *   proceed  — the revision may be released and worked from;
 *   resubmit — a next revision must follow (the verdict authorizes it).
 */
export const VERDICT_EFFECT: ChoiceOption[] = [
  { value: "FINAL", label: "Final — the review is over and the revision can be released", sets: { proceed: true, resubmit: false } },
  { value: "FINAL_FIX_NEXT", label: "Final, fix the comments next time — released now; the comments go into the next revision", sets: { proceed: true, resubmit: true } },
  { value: "RETURN", label: "Back to the author — a new revision is needed before anything is released", sets: { proceed: false, resubmit: true } },
];
export function verdictEffect(props: Record<string, unknown>): string {
  if (props.proceed !== true) return "RETURN";
  return props.resubmit === true ? "FINAL_FIX_NEXT" : "FINAL";
}
export const VERDICT_EFFECT_SHORT: Record<string, string> = { FINAL: "final", FINAL_FIX_NEXT: "final, fix next time", RETURN: "back to the author" };
