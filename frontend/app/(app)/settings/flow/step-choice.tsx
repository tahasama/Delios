import { ActionForm } from "@/components/form";
import { AnswerFrom, PolicyChoice, StampChoices, isFixedAnswer, policySaid, stampsSaid, type AnswerSource } from "@/components/how-it-works";
import { POLICIES } from "@/lib/settings/control-activities";
import { setPolicyAction } from "@/lib/settings/forms-how-it-works";

/**
 * One question about how the project works, on the step it decides: what is chosen, in words, and "Change" opening
 * its answers in place (the stamps with stamping). Saved on its own; the other answers stay as they are. Read only
 * (or kept the same by the organization), the words alone.
 */
export function StepChoice({ source, policyKey, readOnly }: { source: AnswerSource; policyKey: string; readOnly: boolean }) {
  const policy = POLICIES.find((one) => one.key === policyKey);
  if (!policy) return null;
  const stamps = policyKey === "POLICY_PDF_STAMP";
  const said = (
    <>
      <p className="text-[11px] text-slate-500">{policy.title}</p>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] font-medium text-slate-900">
        {policySaid(source.answers, policyKey)}
        <AnswerFrom source={source} of={policyKey} />
      </p>
      {stamps && source.answers.get(policyKey) !== "OFF" ? <p className="text-xs leading-5 text-slate-600">{stampsSaid(source.answers)}</p> : null}
    </>
  );
  if (readOnly || isFixedAnswer(source, policyKey)) return <div className="border-t border-line pt-2.5">{said}</div>;
  return (
    <details className="group border-t border-line pt-2.5">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">{said}</div>
        <span className="shrink-0 text-xs font-semibold text-link group-open:hidden">Change</span>
        <span className="hidden shrink-0 text-xs font-semibold text-slate-500 group-open:inline">Close</span>
      </summary>
      <ActionForm action={setPolicyAction} submitLabel="Save" hidden={{ target: "project" }} className="mt-3 space-y-4">
        <PolicyChoice source={source} policyKey={policyKey} />
        {stamps ? <StampChoices source={source} /> : null}
      </ActionForm>
    </details>
  );
}
