"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Narrowing the catalogue.
 *
 * Ninety-seven checks and their last results are already in hand, so nothing
 * here asks the database anything: choosing is the answer, and there is no
 * Apply to press. It is the register's asking row — plain choices on the
 * sheet — kept to one line, because four choices do not need a grid.
 */
export type Choice = { name: string; value: string; empty: string; options: { code: string; label: string }[]; disabled?: boolean };

export function CheckFilters({ base, choices, count, narrowed }: { base: string; choices: Choice[]; count: string; narrowed: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const go = (name: string, value: string) => {
    const params = new URLSearchParams(base);
    if (value) params.set(name, value);
    else params.delete(name);
    start(() => router.replace(`/conformance/checks${params.size ? `?${params}` : ""}`, { scroll: false }));
  };

  return (
    <section className="register register-sheet register-sheet-open">
      <div className="asking flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-2.5 sm:px-6" data-busy={pending ? "true" : undefined}>
        <span className="stencil shrink-0 text-slate-400">Showing</span>
        {choices.map((choice) => (
          <label key={choice.name} className="min-w-0">
            <span className="sr-only">{choice.empty}</span>
            <select
              name={choice.name}
              value={choice.value}
              disabled={choice.disabled}
              title={choice.disabled ? "Out-of-date risks are not checks: they carry no severity, no owner and no result." : undefined}
              onChange={(event) => go(choice.name, event.target.value)}
              data-on={choice.value ? "true" : "false"}
              className="plain disabled:cursor-not-allowed disabled:opacity-40"
            >
              <option value="">{choice.empty}</option>
              {choice.options.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {narrowed ? (
          <button
            type="button"
            onClick={() => start(() => router.replace("/conformance/checks", { scroll: false }))}
            className="shrink-0 text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
          >
            Clear
          </button>
        ) : null}
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-slate-400">{pending ? "Narrowing…" : count}</span>
      </div>
    </section>
  );
}
