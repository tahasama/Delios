"use client";
import { Select } from "@/components/select";

import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, FolderInput, Trash2, X } from "lucide-react";

/** The boxes tied to the selection form by id (a form cannot sit inside a table cell around them). */
const boxesOf = (formId: string) =>
  [...document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${formId}"][name="valueIds"]`)];

/** Ticks every value shown at once, from the table's head. */
export function SelectAll({ formId, count }: { formId: string; count: number }) {
  return (
    <input
      type="checkbox"
      data-select-all={formId}
      aria-label={`Tick all ${count} values shown`}
      onChange={(event) => {
        for (const box of boxesOf(formId)) box.checked = event.target.checked;
        document.dispatchEvent(new Event("values-ticked"));
      }}
    />
  );
}

/**
 * What can be done with the ticked values, as the register's dock: the count; Retire (those in use) and Bring back (those
 * retired); for those never used, Delete, and Move to another set of the list; Clear. It shows only while something is
 * ticked, and each act says how many it takes.
 */
export function ValuesDock({ formId, otherSets }: { formId: string; otherSets: { id: string; name: string }[] }) {
  const [ticked, setTicked] = useState({ active: 0, retired: 0, unused: 0 });
  const [toSet, setToSet] = useState(otherSets[0]?.id ?? "");
  useEffect(() => {
    const read = () => {
      const on = boxesOf(formId).filter((box) => box.checked);
      setTicked({
        active: on.filter((box) => box.dataset.status !== "RETIRED").length,
        retired: on.filter((box) => box.dataset.status === "RETIRED").length,
        unused: on.filter((box) => box.dataset.used !== "1").length,
      });
    };
    const changed = (event: Event) => { if ((event.target as HTMLInputElement | null)?.name === "valueIds" || event.type === "values-ticked") read(); };
    document.addEventListener("change", changed);
    document.addEventListener("values-ticked", changed);
    read();
    return () => { document.removeEventListener("change", changed); document.removeEventListener("values-ticked", changed); };
  }, [formId]);
  const count = ticked.active + ticked.retired;
  if (!count) return null;
  const clear = () => {
    for (const box of [...boxesOf(formId), ...document.querySelectorAll<HTMLInputElement>(`input[data-select-all="${formId}"]`)]) box.checked = false;
    setTicked({ active: 0, retired: 0, unused: 0 });
  };
  const act = "inline-flex items-center gap-1.5 rounded-sm bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15";
  return (
    <div className="dock palette-light sticky bottom-4 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-sm border border-white/10 bg-brand-strong p-2.5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
      <span className="px-2 font-mono text-sm tabular-nums">{count}<span className="ml-1.5 text-[10px] uppercase tracking-[0.12em] text-white/60">ticked</span></span>
      {ticked.active ? <button type="submit" form={formId} name="op" value="RETIRE" className={act}><Archive className="h-4 w-4" /> Retire ({ticked.active})</button> : null}
      {ticked.retired ? <button type="submit" form={formId} name="op" value="REACTIVATE" className={act}><ArchiveRestore className="h-4 w-4" /> Bring back ({ticked.retired})</button> : null}
      {ticked.unused && otherSets.length ? (
        <span className="inline-flex items-center gap-1 rounded-sm bg-white/10 py-1 pl-3 pr-1 text-xs">
          <FolderInput className="h-4 w-4" aria-hidden />
          <label className="sr-only" htmlFor={`${formId}-to`}>Move to the set</label>
          <Select id={`${formId}-to`} name="toSet" form={formId} value={toSet} onChange={(e) => setToSet(e.target.value)} className="rounded-sm bg-transparent px-1 py-1 text-xs font-semibold text-white outline-none [&>option]:text-slate-900">
            {otherSets.map((one) => <option key={one.id} value={one.id}>to {one.name}</option>)}
          </Select>
          <button type="submit" form={formId} name="op" value="MOVE" className="rounded-sm bg-white/15 px-2.5 py-1 font-semibold hover:bg-white/25">Move ({ticked.unused})</button>
        </span>
      ) : null}
      {ticked.unused ? (
        <button type="submit" form={formId} name="op" value="DELETE" className={`${act} hover:bg-red-500/30`}
          onClick={(e) => { if (!confirm(`Delete ${ticked.unused} value(s) never used? The log keeps them.`)) e.preventDefault(); }}>
          <Trash2 className="h-4 w-4" /> Delete ({ticked.unused})
        </button>
      ) : null}
      {ticked.unused < count ? <span className="px-1 text-[11px] text-white/60">{count - ticked.unused} used: retired, never deleted or moved</span> : null}
      <button type="button" onClick={clear} className="ml-auto rounded-sm p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Clear the ticks" title="Clear the ticks"><X className="h-4 w-4" /></button>
    </div>
  );
}
