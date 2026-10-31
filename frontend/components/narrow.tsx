"use client";

import { useRef } from "react";
import { Select } from "@/components/select";
import { FilterOptions } from "@/components/filter-options";

export type NarrowOption = { code: string; label: string; group?: string };

/**
 * One narrowing choice, drawn as the register draws them (`.plain`, its name as the empty choice). A choice made with
 * the pointer applies at once; one made with the keyboard applies on leaving the box, so stepping through the options
 * with the arrow keys does not reload the page at every step.
 */
export function Narrow({ name, value, empty, options }: { name: string; value: string; empty: string; options: NarrowOption[] }) {
  const pointer = useRef(false);
  const waiting = useRef(false);
  return (
    <label className="min-w-0 flex-1">
      <span className="sr-only">{empty}</span>
      <Select
        name={name}
        defaultValue={value}
        data-on={value ? "true" : "false"}
        data-instant="true"
        className="plain w-full"
        onPointerDown={() => { pointer.current = true; }}
        onKeyDown={() => { pointer.current = false; }}
        onChange={(event) => {
          if (pointer.current) event.currentTarget.form?.requestSubmit();
          else waiting.current = true;
        }}
        onBlur={(event) => {
          if (!waiting.current) return;
          waiting.current = false;
          event.currentTarget.form?.requestSubmit();
        }}
      >
        <option value="">{empty}</option>
        <FilterOptions options={options} />
      </Select>
    </label>
  );
}
