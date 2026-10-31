"use client";

import { Narrow, type NarrowOption } from "@/components/narrow";
import { SwitchControl } from "@/components/switch";
import { FilterMenu } from "@/components/filter-menu";

/**
 * How the matrix is narrowed: the register's way (`.asking`, one line of choices that apply on pick), and the
 * disciplines in use as a switch that applies at once. No Apply: nothing here is typed.
 */
export function MatrixFilters({ shown, values, options }: {
  shown: string[];
  values: { discipline: string; producer: string; type: string; inuse: boolean };
  options: { disciplines: NarrowOption[]; producers: NarrowOption[]; types: NarrowOption[] };
}) {
  const show = (key: string, held: boolean) => shown.includes(key) || held;
  return (
    <form method="get" className="asking flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5 sm:px-6"
      key={`${values.discipline}|${values.producer}|${values.type}|${values.inuse}`}>
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
        {show("discipline", !!values.discipline) ? <Narrow name="discipline" value={values.discipline} empty="Every discipline" options={options.disciplines} /> : null}
        {show("producer", !!values.producer) ? <Narrow name="producer" value={values.producer} empty="Any deliverable type" options={options.producers} /> : null}
        {show("type", !!values.type) ? <Narrow name="type" value={values.type} empty="Any document type" options={options.types} /> : null}
      </div>
      {show("inuse", values.inuse) ? (
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600"
          onChange={(event) => (event.target as unknown as HTMLInputElement).form?.requestSubmit()}>
          <SwitchControl name="inuse" value="1" defaultChecked={values.inuse} />
          Only the disciplines in use here
        </label>
      ) : null}
      <FilterMenu page="distribution" shown={shown} filters={[
        { key: "discipline", label: "Discipline", held: !!values.discipline },
        { key: "producer", label: "Deliverable type", held: !!values.producer },
        { key: "type", label: "Document type", held: !!values.type },
        { key: "inuse", label: "Only the disciplines in use", held: values.inuse },
      ]} />
    </form>
  );
}
