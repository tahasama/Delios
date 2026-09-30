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
 * Who receives it, the way an email is addressed: the people it is sent to —
 * asked to do something, and the ones "seen" is read from — and, apart, the
 * people copied in, kept informed and never asked. Each list is found by
 * typing part of a name, a company or a job, and Enter takes the one
 * highlighted; as many as needed, each removable.
 *
 * Only people who exist can be chosen, so a name nobody can be matched to never
 * reaches a transmittal, and everyone chosen can open it.
 */
export function RecipientPicker({ companies, preselected = [], preselectedCopies = [], label = "Sent to", onCount }: {
  companies: Company[];
  preselected?: string[];
  /** People copied in — kept informed, and never asked for anything. */
  preselectedCopies?: string[];
  /** What the first list is called: who it goes to, or, for what we received, who it is for. */
  label?: string;
  /** How many it is addressed to, so the form can say when nobody is. */
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
  const addressed = chosen.filter((one) => !one.copy).length;
  useEffect(() => { onCount?.(addressed); }, [addressed, onCount]);

  const add = (people: Person[], copy: boolean) =>
    setChosen((list) => [...list, ...people.filter((p) => !list.some((one) => one.id === p.id)).map((p) => ({ ...p, copy }))]);
  const remove = (id: string) => setChosen((list) => list.filter((one) => one.id !== id));

  return (
    <div className="space-y-5">
      {/* The ids travel as the form's fields, whichever list they sit in. */}
      {chosen.map((one) => <input key={one.id} type="hidden" name={one.copy ? "copyUsers" : "recipientUsers"} value={one.id} />)}
      <Block
        label={label}
        required
        hint="asked to do something with it — type a name, a company or a job, then Enter"
        copy={false}
        everyone={everyone}
        companies={companies}
        chosen={chosen}
        onAdd={add}
        onRemove={remove}
      />
      <Block
        label="Copy to (cc)"
        hint="kept informed, never asked — optional"
        copy
        everyone={everyone}
        companies={companies}
        chosen={chosen}
        onAdd={add}
        onRemove={remove}
      />
    </div>
  );
}

/** One list: its search, what the search finds, and who is on it. */
export function Block({ label, hint, required, copy, everyone, companies, chosen, onAdd, onRemove }: {
  label: string;
  hint: string;
  required?: boolean;
  copy: boolean;
  everyone: Person[];
  companies: Company[];
  chosen: Chosen[];
  onAdd: (people: Person[], copy: boolean) => void;
  onRemove: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = copy ? "cc-options" : "to-options";

  // Clicking anywhere else closes the list.
  useEffect(() => {
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  // Somebody already on either list is not offered again.
  const taken = new Set(chosen.map((one) => one.id));
  const mine = chosen.filter((one) => one.copy === copy);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = everyone
    .filter((p) => !taken.has(p.id))
    .filter((p) => words.every((w) => `${p.name} ${p.company} ${p.job ?? ""}`.toLowerCase().includes(w)))
    .slice(0, 12);
  // A company whose name matches offers everyone at it at once, after the people.
  const whole = words.length
    ? companies
        .filter((c) => words.every((w) => c.name.toLowerCase().includes(w)))
        .map((c) => ({ company: c, rest: everyone.filter((p) => p.company === c.name && !taken.has(p.id)) }))
        .filter((one) => one.rest.length > 1)
    : [];
  const options: { key: string; people: Person[]; person?: Person; everyoneAt?: string }[] = [
    ...matches.map((p) => ({ key: p.id, people: [p], person: p })),
    ...whole.map((w) => ({ key: `all:${w.company.key}`, people: w.rest, everyoneAt: w.company.name })),
  ];

  const take = (index: number) => {
    const option = options[index];
    if (!option) return;
    onAdd(option.people, copy);
    setQuery("");
    setHi(0);
  };

  return (
    <div ref={box}>
      <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="stencil text-slate-500">{label}{required ? <span className="ml-0.5 text-red-500">*</span> : null}</span>
        <span className="text-[11px] text-slate-400">{hint}</span>
      </p>

      <div className="relative">
        <div className="flex items-center gap-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <label className="min-w-0 flex-1">
            <span className="sr-only">{copy ? "Find somebody to copy in" : "Find a person"}</span>
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); setHi(0); }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((n) => Math.min(n + 1, options.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setHi((n) => Math.max(n - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); if (open && options.length) take(hi); }
                else if (e.key === "Escape") setOpen(false);
                else if (e.key === "Backspace" && !query && mine.length) onRemove(mine[mine.length - 1].id);
              }}
              placeholder={mine.length ? "Add another…" : copy ? "Nobody copied in" : "e.g. ou, electrical, Ferrand…"}
              className="plain w-full py-1.5 text-[13px]"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              autoComplete="off"
            />
          </label>
        </div>

        {open && query ? (
          <ul id={listId} role="listbox" className="dt-menu absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg py-1">
            {options.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400">Nobody matches that.</li>
            ) : options.map((option, i) => (
              <li
                key={option.key}
                role="option"
                aria-selected={i === hi}
                onMouseDown={(e) => { e.preventDefault(); take(i); }}
                onMouseEnter={() => setHi(i)}
                className={cn("flex cursor-pointer items-baseline gap-2 px-3 py-1.5 text-[13px]", i === hi ? "bg-tint text-slate-900" : "text-slate-700")}
              >
                {option.person ? (
                  <>
                    <span className="font-medium">{option.person.name}</span>
                    <span className="text-[11px] text-slate-400">{option.person.company}{option.person.job ? ` · ${option.person.job}` : ""}{option.person.offline ? " · not on this system" : ""}</span>
                  </>
                ) : (
                  <span className="font-medium text-brand-ink">Everyone at {option.everyoneAt} <span className="font-normal text-slate-400">({option.people.length})</span></span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {mine.length ? (
        <ul className="mt-2.5 divide-y divide-line rounded-lg border border-line">
          {mine.map((one) => (
            <li key={one.id} className="px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 text-[13px]">
                  <span className="font-medium text-slate-800">{one.name}</span>
                  <span className="text-slate-400"> &middot; {one.company}</span>
                </span>
                <button type="button" onClick={() => onRemove(one.id)} className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-tint-soft hover:text-slate-700" aria-label={`Remove ${one.name}`}>
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

/**
 * Who is copied in when something is sent back: the people it goes back to are
 * settled by the record and shown, not chosen; everyone else starts as those
 * who sat on the route, and Document Control adds or removes as it sees fit.
 */
export function CopyPicker({ companies, backTo, preselected = [] }: { companies: Company[]; backTo: string; preselected?: string[] }) {
  const everyone = useMemo<Person[]>(
    () => companies.flatMap((c) => c.people.map((p) => ({ id: p.id, name: p.name, job: p.job ?? null, company: c.name, offline: c.offline }))),
    [companies],
  );
  const byId = useMemo(() => new Map(everyone.map((p) => [p.id, p] as const)), [everyone]);
  const [chosen, setChosen] = useState<Chosen[]>(() => preselected.flatMap((id) => (byId.get(id) ? [{ ...byId.get(id)!, copy: true }] : [])));
  return (
    <div className="space-y-3">
      <input type="hidden" name="copiesChosen" value="1" />
      {chosen.map((one) => <input key={one.id} type="hidden" name="copyUsers" value={one.id} />)}
      <p className="text-xs text-slate-600"><span className="stencil mr-2 text-slate-500">Goes back to</span>{backTo}</p>
      <Block
        label="Copy to (cc)"
        hint="told it went back and why — edit as needed"
        copy
        everyone={everyone}
        companies={companies}
        chosen={chosen}
        onAdd={(people) => setChosen((list) => [...list, ...people.filter((p) => !list.some((one) => one.id === p.id)).map((p) => ({ ...p, copy: true }))])}
        onRemove={(id) => setChosen((list) => list.filter((one) => one.id !== id))}
      />
    </div>
  );
}
