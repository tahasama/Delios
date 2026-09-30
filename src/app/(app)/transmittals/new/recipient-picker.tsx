"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * `offline` is set for an organization with no accounts here: who of ours sends
 * it on to them. Their one "person" is their contact, and is not an account.
 */
export type Company = { key: string; name: string; people: { id: string; name: string; job?: string | null }[]; offline?: string };

type Person = { id: string; name: string; job: string | null; company: string; offline?: string };
type Chosen = Person & { copy: boolean };

/**
 * Who receives it, found by typing rather than by scrolling two lists: part of
 * a name, a company or a job, and Enter takes the one highlighted. As many
 * people as needed, each either addressed — asked to do something, and the
 * ones "seen" is read from — or copied in, and each removable.
 *
 * Only people who exist can be chosen, so a name nobody can be matched to never
 * reaches a transmittal, and everyone chosen can open it.
 */
export function RecipientPicker({ companies, preselected = [], preselectedCopies = [], label = "Sent to", onCount }: {
  companies: Company[];
  preselected?: string[];
  /** People copied in — kept informed, and never asked for anything. */
  preselectedCopies?: string[];
  /** What the list is called: who it goes to, or, for what we received, who it is for. */
  label?: string;
  /** How many are chosen, so the form can say when nobody is. */
  onCount?: (n: number) => void;
}) {
  const everyone = useMemo<Person[]>(
    () => companies.flatMap((c) => c.people.map((p) => ({ id: p.id, name: p.name, job: p.job ?? null, company: c.name, offline: c.offline }))),
    [companies],
  );
  const byId = useMemo(() => new Map(everyone.map((p) => [p.id, p] as const)), [everyone]);
  const [chosen, setChosen] = useState<Chosen[]>(() => [
    ...preselected.flatMap((id) => (byId.get(id) ? [{ ...byId.get(id)!, copy: false }] : [])),
    ...preselectedCopies.filter((id) => !preselected.includes(id)).flatMap((id) => (byId.get(id) ? [{ ...byId.get(id)!, copy: true }] : [])),
  ]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { onCount?.(chosen.length); }, [chosen.length, onCount]);
  // Clicking anywhere else closes the list.
  useEffect(() => {
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const taken = new Set(chosen.map((one) => one.id));
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = everyone
    .filter((p) => !taken.has(p.id))
    .filter((p) => words.every((w) => `${p.name} ${p.company} ${p.job ?? ""}`.toLowerCase().includes(w)))
    .slice(0, 12);
  // A company whose name matches offers everyone at it at once, after the people.
  const whole = words.length
    ? companies
        .filter((c) => words.every((w) => c.name.toLowerCase().includes(w)))
        .map((c) => ({ company: c, rest: c.people.filter((p) => !taken.has(p.id)) }))
        .filter((one) => one.rest.length > 1)
    : [];
  const options = [
    ...matches.map((p) => ({ key: p.id, add: () => [p] })),
    ...whole.map((w) => ({ key: `all:${w.company.key}`, add: () => w.rest.map((p) => byId.get(p.id)!) })),
  ];

  const take = (index: number) => {
    const option = options[index];
    if (!option) return;
    setChosen((list) => [...list, ...option.add().filter((p) => !list.some((one) => one.id === p.id)).map((p) => ({ ...p, copy: false }))]);
    setQuery("");
    setHi(0);
  };

  return (
    <div ref={box}>
      <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="stencil text-slate-500">{label}<span className="ml-0.5 text-red-500">*</span></span>
        <span className="text-[11px] text-slate-400">type a name, a company or a job, then Enter — as many as needed</span>
      </p>

      <div className="relative">
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <label className="min-w-0 flex-1">
            <span className="sr-only">Find a person</span>
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); setHi(0); }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((n) => Math.min(n + 1, options.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setHi((n) => Math.max(n - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); if (open && options.length) take(hi); }
                else if (e.key === "Escape") setOpen(false);
                else if (e.key === "Backspace" && !query && chosen.length) setChosen((list) => list.slice(0, -1));
              }}
              placeholder={chosen.length ? "Add another…" : "e.g. ou, electrical, Ferrand…"}
              className="plain w-full py-1.5 text-[13px]"
              role="combobox"
              aria-expanded={open}
              aria-controls="recipient-options"
              autoComplete="off"
            />
          </label>
        </div>

        {open && (query || !chosen.length) ? (
          <ul id="recipient-options" role="listbox" className="dt-menu absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg py-1">
            {options.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400">Nobody matches that.</li>
            ) : options.map((option, i) => {
              const person = byId.get(option.key);
              const group = whole.find((w) => `all:${w.company.key}` === option.key);
              return (
                <li
                  key={option.key}
                  role="option"
                  aria-selected={i === hi}
                  onMouseDown={(e) => { e.preventDefault(); take(i); }}
                  onMouseEnter={() => setHi(i)}
                  className={cn("flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-[13px]", i === hi ? "bg-tint text-slate-900" : "text-slate-700")}
                >
                  {person ? (
                    <>
                      <span className="font-medium">{person.name}</span>
                      <span className="text-[11px] text-slate-400">{person.company}{person.job ? ` · ${person.job}` : ""}{person.offline ? " · not on this system" : ""}</span>
                    </>
                  ) : group ? (
                    <span className="font-medium text-brand-ink">Everyone at {group.company.name} <span className="font-normal text-slate-400">({group.rest.length})</span></span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {chosen.length ? (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {chosen.map((one) => (
            <li key={one.id} className="px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <input type="hidden" name={one.copy ? "copyUsers" : "recipientUsers"} value={one.id} />
                <span className="min-w-0 flex-1 text-[13px]">
                  <span className="font-medium text-slate-800">{one.name}</span>
                  <span className="text-slate-400"> &middot; {one.company}</span>
                </span>
                {/* Asked, or only kept informed. Said in a word, because it
                    changes what the transmittal means for that person — and
                    because "seen" is read from the first kind only. */}
                <span className="seg p-0.5!" role="radiogroup" aria-label={`${one.name}: addressed or copied in`}>
                  {([false, true] as const).map((copy) => (
                    <button
                      key={String(copy)}
                      type="button"
                      aria-current={one.copy === copy ? "page" : undefined}
                      onClick={() => setChosen((list) => list.map((x) => (x.id === one.id ? { ...x, copy } : x)))}
                      className="segment px-2! py-0.5! text-[11px]!"
                      title={copy ? "Kept informed, never asked" : "Asked to do something with it; “seen” is read from these"}
                    >
                      {copy ? "Copy" : "Addressed"}
                    </button>
                  ))}
                </span>
                <button type="button" onClick={() => setChosen((list) => list.filter((x) => x.id !== one.id))} className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-tint-soft hover:text-slate-700" aria-label={`Remove ${one.name}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {one.offline ? <p className="mt-1 text-[11px] text-slate-500">Not on this system — {one.offline} sends it to them and records the proof.</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
