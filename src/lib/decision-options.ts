import { verdictEffect, VERDICT_EFFECT_SHORT } from "./verdict-effect";
import type { VerdictOption, StatusOption } from "@/app/(app)/documents/[id]/verdict-status";

type SetValue = { code: string; label: string; props: Record<string, unknown> };

/** A published verdict list as the deciding step's form needs it. */
export function decisionOptions(values: SetValue[]): VerdictOption[] {
  return values.map((v) => {
    const effect = verdictEffect(v.props);
    return {
      code: v.code,
      label: v.label,
      effect: VERDICT_EFFECT_SHORT[effect],
      proceeds: effect !== "RETURN",
      resubmit: v.props.resubmit === true,
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
