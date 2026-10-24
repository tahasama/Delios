"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/core/utils";

export type PickItem = { id: string; name: string; detail?: string | null; note?: string | null };

/**
 * Choosing from a list by typing, the way a transmittal is addressed: type part
 * of a name, a company or a job, arrow to it, Enter takes it. Everything chosen
 * shows below, each removable; Backspace in an empty search removes the last.
 * The choice travels as hidden fields named `name`, one per item.
 *
 * One picker for every place people (or documents) are chosen, so a reviewer, a
 * person copied in, a recipient and a delegate are all found the same way.
 */
export function SearchPick({
  items, name, initial = [], label, hint, required, placeholder, empty, single, onCount, onChange, compact, browse,
}: {
  items: PickItem[];
  name: string;
  initial?: string[];
  label?: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  /** Said when nothing is chosen; nothing is said if left out. */
  empty?: string;
  /** Exactly one may be chosen: taking another replaces it. */
  single?: boolean;
  onCount?: (n: number) => void;
  /** Told the chosen ids whenever they change. */
  onChange?: (ids: string[]) => void;
  /** Kept for callers: every list now opens on a click and narrows as one types (owner). */
  browse?: boolean;
  /** Tighter, for a narrow card. */
  compact?: boolean;
}) {
  const byId = useMemo(() => new Map(items.map((one) => [one.id, one] as const)), [items]);
  const [chosen, setChosen] = useState<string[]>(() => initial.filter((id) => byId.has(id)).slice(0, single ? 1 : undefined));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // Where the list stands: drawn over the page (owner: "drawer is blocked by card"), so no card, scrolling row or
  // sheet cuts it; under the field, or above it when the window has no room under it.
  const [at, setAt] = useState<React.CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = field.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
      const up = below < 200 && above > below;
      setAt({
        position: "fixed", left: r.left, width: r.width, maxHeight: Math.min(320, up ? above : below),
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);
  useEffect(() => { onCount?.(chosen.length); }, [chosen.length, onCount]);
  // Told after the choice settles, so a parent can follow it without owning it.
  const told = useRef(onChange);
  told.current = onChange;
  useEffect(() => { told.current?.(chosen); }, [chosen]);

  // Clicking anywhere else closes the list.
  useEffect(() => {
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!box.current?.contains(target) && !list.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const options = items
    .filter((one) => !chosen.includes(one.id))
    .filter((one) => words.every((w) => `${one.name} ${one.detail ?? ""}`.toLowerCase().includes(w)))
    .slice(0, 1000);

  const take = (index: number) => {
    const one = options[index];
    if (!one) return;
    setChosen((list) => (single ? [one.id] : [...list, one.id]));
    setQuery("");
    setHi(0);
    if (single) setOpen(false);
  };
  const remove = (id: string) => setChosen((list) => list.filter((one) => one !== id));

  return (
    <div ref={box}>
      {chosen.map((id) => <input key={id} type="hidden" name={name} value={id} />)}
      {label ? (
        <p className="mb-1.5 flex h-4 min-w-0 items-baseline gap-2 leading-4 overflow-hidden">
          <span className="stencil shrink-0 text-slate-500">{label}{required ? <span className="ml-0.5 text-red-500">*</span> : null}</span>
          {hint ? <span className="min-w-0 truncate text-[11px] leading-4 text-slate-400" title={hint}>{hint}</span> : null}
        </p>
      ) : null}

      <div className="relative">
        {/* The magnifier sits inside the field, so its line starts where every other field's does. */}
        <div ref={field} className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); setHi(0); }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((n) => Math.min(n + 1, options.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHi((n) => Math.max(n - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); if (open && options.length) take(hi); }
              else if (e.key === "Escape") setOpen(false);
              else if (e.key === "Backspace" && !query && chosen.length) remove(chosen[chosen.length - 1]);
            }}
            placeholder={placeholder ?? (chosen.length && !single ? "Add another…" : "Choose, or type to narrow")}
            aria-label={label ?? placeholder ?? "Search"}
            role="combobox"
            aria-expanded={open}
            autoComplete="off"
            className={cn("plain w-full !pl-7", compact ? "py-1 text-xs" : "py-1.5 text-[13px]")}
          />
        </div>

        {/* Every list opens on a click and narrows as one types (owner, everywhere). */}
        {open && at ? createPortal(
          <ul ref={list} role="listbox" style={at} className="scroll-thin z-[60] overflow-y-auto rounded-md bg-surface py-1 shadow-lg ring-1 ring-line">
            {options.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400">{query ? "Nobody matches that." : "Nobody left to choose."}</li>
            ) : options.map((one, i) => (
              <li
                key={one.id}
                role="option"
                aria-selected={i === hi}
                onMouseDown={(e) => { e.preventDefault(); take(i); }}
                onMouseEnter={() => setHi(i)}
                className={cn("flex cursor-pointer items-start gap-2 px-3 py-1.5", i === hi ? "bg-tint-soft" : "")}
              >
                <span className="min-w-0">
                  <span className={cn("block truncate text-slate-800", compact ? "text-xs" : "text-[13px]")}>{one.name}</span>
                  {one.detail ? <span className="block truncate font-mono text-[11px] text-slate-500">{one.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>, document.body,
        ) : null}
      </div>

      {chosen.length ? (
        <ul className={cn("divide-y divide-line rounded-lg border border-line", compact ? "mt-1.5" : "mt-2.5")}>
          {chosen.map((id) => {
            const one = byId.get(id)!;
            return (
              <li key={id} className={compact ? "px-2 py-1" : "px-3 py-2"}>
                <div className="flex items-center gap-2">
                  <span className={cn("min-w-0 flex-1", compact ? "text-xs" : "text-[13px]")}>
                    <span className="font-medium text-slate-800">{one.name}</span>
                    {one.detail ? <span className={cn("text-slate-400", compact ? "block truncate text-[10px]" : "")}>{compact ? one.detail : <> &middot; {one.detail}</>}</span> : null}
                  </span>
                  <button type="button" onClick={() => remove(id)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-tint-soft hover:text-slate-700" aria-label={`Remove ${one.name}`}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {one.note ? <p className="mt-1 text-[11px] text-slate-500">{one.note}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : empty ? (
        <p className="mt-1.5 text-[11px] text-amber-700">{empty}</p>
      ) : null}
    </div>
  );
}
