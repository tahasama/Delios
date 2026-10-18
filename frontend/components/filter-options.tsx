/** A filter's choice; `group` is the set of its list it belongs to, when the list has several (`lib/settings/in-sets.ts`). */
export type FilterOpt = { code: string; label: string; group?: string };

/** A filter's choices: under each set's name when they carry one, else plain. */
export function FilterOptions({ options }: { options: FilterOpt[] }) {
  if (!options.some((option) => option.group)) return <>{options.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</>;
  return (
    <>
      {[...new Set(options.map((option) => option.group ?? ""))].map((group) => (
        <optgroup key={group} label={group || "Other"}>
          {options.filter((option) => (option.group ?? "") === group).map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
        </optgroup>
      ))}
    </>
  );
}
