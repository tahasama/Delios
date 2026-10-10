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
      blocks: v.props.blocking === true || v.props.comments === "blocking",
      // Advice has no code anybody quotes — NO_COMMENT is a name, not a code —
      // so only its words are shown. A verdict's code is quoted daily.
      advice: v.props.advice === true,
      // A verdict that says anything is wrong needs somewhere to say it: one
      // that sends the revision back, one that carries comments into the next
      // revision, and any advice whose own list says it has comments. A clean
      // accept, and "nothing to say", have nothing to add and are not asked.
      wantsComment: effect === "RETURN" || v.props.resubmit === true || v.props.blocking === true || v.props.comments === "some" || v.props.comments === "blocking",
      meaning: typeof v.props.meaning === "string" ? v.props.meaning : null,
    };
  });
}

/**
 * The statuses a deciding verdict can send a revision out at, with what each
 * permits. A route may narrow the list to some of them; `only` is what the step
 * was asked to decide between, and an empty list means the whole list.
 */
export function statusOptions(values: SetValue[], only?: string[] | null): StatusOption[] {
  const narrowed = only?.length ? values.filter((v) => only.includes(v.code)) : values;
  return narrowed.map((v) => {
    return {
      code: v.code,
      label: v.label,
      allowsWork: v.props.executionFlag === true,
      may: typeof v.props.may === "string" ? v.props.may : null,
    };
  });
}
