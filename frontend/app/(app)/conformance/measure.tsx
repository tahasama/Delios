import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/core/utils";
import { setMeasureAction } from "@/lib/conformance/forms";
import { type ScopeConfig } from "@/lib/settings/api-admin";

/**
 * How this project is measured, said once, where it is measured: the share of clear documents it
 * aims at, and how often the checks are run. An administrator or the control function changes it.
 */
export function HowMeasured({ scope, mayChange }: { scope: ScopeConfig; mayChange: boolean }) {
  const line = (
    <span className="text-[13px] text-slate-600">
      <span className="font-semibold text-slate-800">How it is measured:</span> target {scope.integrityThreshold}% of
      documents clear · checked at least every {scope.measurementIntervalDays} days
      {scope.measuredBy ? <span className="text-[11px] text-slate-500"> · set by {scope.measuredBy.name}, {fmtDate(new Date(scope.measuredBy.at))}</span> : null}
    </span>
  );
  if (!mayChange) return <div className="register register-sheet px-5 py-3 sm:px-6">{line}</div>;
  return (
    <details className="register register-sheet register-sheet-open no-print">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 sm:px-6 [&::-webkit-details-marker]:hidden">
        {line}
        <span className="ask">Change</span>
      </summary>
      <div className="border-t border-line px-5 py-4 sm:px-6">
        <ActionForm action={setMeasureAction} submitLabel="Save">
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            <Field label="Target (% of documents clear)" required hint="below it, the statement says the register is not controlled">
              <input type="number" name="integrityThreshold" required defaultValue={scope.integrityThreshold} min={50} max={100} className={inputCls} />
            </Field>
            <Field label="Checked at least every (days)" required hint="past it, the figure says the checks are due">
              <input type="number" name="measurementIntervalDays" required defaultValue={scope.measurementIntervalDays} min={1} max={365} className={inputCls} />
            </Field>
          </div>
        </ActionForm>
      </div>
    </details>
  );
}
