import { verdictEffect, VERDICT_EFFECT_SHORT } from "./verdict-effect";
import type { VerdictOption, StatusOption } from "@/app/(app)/documents/[id]/verdict-status";

type SetValue = { code: string; label: string; props: Record<string, unknown> };

/**
 * A published list as the decision form needs it. Advice and verdicts come
 * from different lists, and the form only has to know which one it was given:
 * an advice value carries `advice: true` and says which comments it claims.
 */
export function decisionOptions(values: SetValue[]): VerdictOption[] {
  return values.map((v) => {
    const effect = verdictEffect(v.props);
    const advice = v.props.advice === true;
    return {
      code: v.code,
      label: v.label,
      effect: VERDICT_EFFECT_SHORT[effect],
      proceeds: advice ? true : effect !== "RETURN",
      resubmit: v.props.resubmit === true,
      advice,
      comments: typeof v.props.comments === "string" ? v.props.comments : null,
      meaning: typeof v.props.meaning === "string" ? v.props.meaning : null,
    };
  });
}

/** The statuses a deciding verdict can send a revision out at, with what each permits. */
export function statusOptions(values: SetValue[]): StatusOption[] {
  return values.map((v) => ({
    code: v.code,
    label: v.label,
    allowsWork: v.props.executionFlag === true,
    may: typeof v.props.may === "string" ? v.props.may : null,
  }));
}
