export type ChoiceOption = { value: string; label: string; sets: Record<string, unknown> };

/**
 * What a review verdict means, asked once. Every organization's verdict list,
 * whatever its codes and names, says one of these four things: the set's
 * names change, the meanings never do. Stored as the Standard's consequences
 * (§9.3), which the rest of the app reads:
 *   proceed     — the revision may be released and worked from;
 *   resubmit    — a next revision must follow (the verdict authorizes it);
 *   information — accepted for information only, nobody reviewed its content.
 * Who holds a supplier's document after the review follows the meaning: a
 * verdict with comments to take into the next revision, or one that sends it
 * back, hands it to the supplier; the other two leave it with us.
 */
export const VERDICT_EFFECT: ChoiceOption[] = [
  { value: "FINAL", label: "Accepted — the review is over and the revision can be released", sets: { proceed: true, resubmit: false, information: false } },
  { value: "FINAL_FIX_NEXT", label: "Accepted with comments — released now; the comments go into the next revision", sets: { proceed: true, resubmit: true, information: false } },
  { value: "RETURN", label: "Rejected — back to the author; a new revision is needed before anything is released", sets: { proceed: false, resubmit: true, information: false } },
  { value: "INFORMATION", label: "For information — taken as it is, its content not reviewed", sets: { proceed: true, resubmit: false, information: true } },
];
export function verdictEffect(props: Record<string, unknown>): string {
  if (props.proceed !== true) return "RETURN";
  if (props.information === true) return "INFORMATION";
  return props.resubmit === true ? "FINAL_FIX_NEXT" : "FINAL";
}
export const VERDICT_EFFECT_SHORT: Record<string, string> = { FINAL: "final", FINAL_FIX_NEXT: "final, fix next time", RETURN: "back to the author", INFORMATION: "for information" };

/** What a verdict of each meaning says, in a sentence, whatever the organization calls it. */
export const VERDICT_EFFECT_BLURB: Record<string, string> = {
  FINAL: "Fit for the use its status permits. Nothing outstanding.",
  FINAL_FIX_NEXT: "Fit to work from. The comments go into the next revision.",
  RETURN: "Not fit to work from. A new revision resolves the comments.",
  INFORMATION: "Taken for information as it is; its content was not reviewed.",
};
