"use client";

import { useState } from "react";
import { Choice, type ChoiceOption } from "@/components/choice";

/**
 * Which scheme numbers a deliverable type or a record, and the number it would make: the example follows the scheme
 * picked at once, before Save, so what is about to be chosen reads as it will number.
 */
export function SchemeChoice({ label, chosen, options, examples, empty }: {
  label: string;
  chosen: string;
  options: ChoiceOption[];
  /** The number each scheme makes, by its name (none: it has no parts yet). */
  examples: Record<string, string | null>;
  /** What is said when no scheme is chosen. */
  empty: React.ReactNode;
}) {
  const [value, setValue] = useState(chosen);
  const example = value ? examples[value] : undefined;
  return (
    <>
      <div className="col-span-2 md:col-span-1">
        <Choice name="schemeName" label={label} defaultValue={chosen} placeholder="Choose a scheme…" options={options} onChange={setValue} />
      </div>
      <span className="col-span-2 min-w-0 truncate font-mono text-[12px] text-slate-500 md:col-span-1" title={example ?? undefined}>
        {value ? example ?? <span className="font-sans text-[11px] text-amber-700">its scheme has no parts yet</span> : empty}
      </span>
    </>
  );
}
