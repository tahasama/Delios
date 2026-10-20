"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/core/utils";

export type JumpItem = { href: string; label: string; detail?: string | null; on?: boolean };

/**
 * A filter with many choices, as a search field (owner: a row of chips grows with every organization): it shows
 * what is chosen, lists everything on a click, narrows as one types, and choosing applies at once (each choice is
 * an address, as a chip was). Arrows and Enter work as in `SearchPick`.
 */
export function JumpPick({ items, label, className }: { items: JumpItem[]; label: string; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const current = items.find((one) => one.on);

  useEffect(() => {
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) { setOpen(false); setQuery(""); } };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const options = items.filter((one) => words.every((w) => `${one.label} ${one.detail ?? ""}`.toLowerCase().includes(w)));
  const go = (index: number) => {
    const one = options[index];
    if (!one) return;
    setOpen(false);
    setQuery("");
    router.push(one.href, { scroll: false });
  };

  return (
    <div ref={box} className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      <input
        value={open ? query : current?.label ?? ""}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((n) => Math.min(n + 1, options.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((n) => Math.max(n - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (open) go(hi); }
          else if (e.key === "Escape") { setOpen(false); setQuery(""); }
        }}
        placeholder={open ? "Type to narrow" : current?.label ?? "Choose"}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        className="plain w-full !pr-7 !pl-7"
      />
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      {open ? (
        <ul role="listbox" className="scroll-thin absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md bg-surface py-1 shadow-lg ring-1 ring-line">
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-400">Nothing matches that.</li>
          ) : options.map((one, i) => (
            <li
              key={one.href}
              role="option"
              aria-selected={one.on ?? false}
              onMouseDown={(e) => { e.preventDefault(); go(i); }}
              onMouseEnter={() => setHi(i)}
              className={cn("flex cursor-pointer items-start gap-2 px-3 py-1.5", i === hi ? "bg-tint-soft" : "")}
            >
              <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-link", one.on ? "" : "invisible")} aria-hidden />
              <span className="min-w-0">
                <span className={cn("block truncate text-[13px] text-slate-800", one.on && "font-semibold")}>{one.label}</span>
                {one.detail ? <span className="block truncate text-[11px] text-slate-500">{one.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
