"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/core/utils";
import { inputCls } from "@/components/ui";

export type ChoiceOption = { value: string; label: string; hint?: string };

/**
 * A choice among a few, drawn as the app draws it rather than the browser's own list: each option its name and, under
 * it, what it means (a scheme's example number…). It sits in a form like a select (`name`, sent with the form) and is
 * worked the same way with the keyboard: Enter, Space or the arrows open it, the arrows move, Enter chooses, Escape
 * closes. For a choice whose options need saying; a plain list of words stays a select.
 */
export function Choice({ name, options, defaultValue = "", placeholder = "Choose…", label, className }: {
  name: string;
  options: ChoiceOption[];
  defaultValue?: string;
  placeholder?: string;
  /** What is chosen, for screen readers ("Scheme for Transmittals"). */
  label: string;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useId();
  const chosen = options.find((one) => one.value === value);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  function show() {
    setActive(Math.max(0, options.findIndex((one) => one.value === value)));
    setOpen(true);
  }
  function pick(index: number) {
    const one = options[index];
    if (one) setValue(one.value);
    setOpen(false);
  }
  function key(event: React.KeyboardEvent) {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); show(); }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
    else if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(active); }
    else if (event.key === "Tab") setOpen(false);
  }

  return (
    <div ref={box} className={cn("relative", className)}>
      <input type="hidden" name={name} value={value} />
      <button type="button" role="combobox" aria-expanded={open} aria-controls={list} aria-haspopup="listbox" aria-label={label}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={key}
        className={cn(inputCls, "flex cursor-pointer items-center justify-between gap-2 rounded-t-sm px-2 text-left",
          // Grey like the asking fields (.asking .plain), so it reads as a field to fill wherever it sits.
          "bg-[color-mix(in_oklab,var(--color-canvas)_60%,var(--color-surface))] hover:bg-[color-mix(in_oklab,var(--color-canvas)_85%,var(--color-surface))]",
          "aria-expanded:bg-[color-mix(in_oklab,var(--color-canvas)_85%,var(--color-surface))]")}>
        <span className={cn("truncate", chosen ? "" : "text-slate-400")}>{chosen?.label ?? placeholder}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform duration-150", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? (
        <ul id={list} role="listbox" aria-label={label}
          className="scroll-thin absolute left-0 z-30 mt-1 max-h-80 min-w-full overflow-y-auto rounded-md bg-surface py-1 shadow-lg ring-1 ring-line">
          {options.map((one, index) => {
            const on = one.value === value;
            return (
              <li key={one.value} role="option" aria-selected={on} onMouseEnter={() => setActive(index)} onMouseDown={(event) => { event.preventDefault(); pick(index); }}
                className={cn("flex cursor-pointer items-start gap-2 px-3 py-1.5", index === active ? "bg-tint-soft" : "")}>
                <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-link", on ? "" : "invisible")} aria-hidden="true" />
                <span className="min-w-0">
                  <span className={cn("block truncate text-[13px] text-slate-800", on && "font-semibold")}>{one.label}</span>
                  {one.hint ? <span className="block truncate font-mono text-[11px] text-slate-500">{one.hint}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
