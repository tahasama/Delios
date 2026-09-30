"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

/**
 * `offline` is set for an organization with no accounts here: who of ours sends
 * it on to them. Their one "person" is their contact, and is not an account.
 */
export type Company = { key: string; name: string; people: { id: string; name: string; job?: string | null }[]; offline?: string };

/**
 * Who receives it, chosen rather than typed: a company, then a person in that
 * company. A transmittal is evidence that named people were told, so a name
 * nobody can be matched to is worth nothing — and everyone named here can open
 * the transmittal and the documents it carries.
 */
export function RecipientPicker({ companies, preselected = [], preselectedCopies = [], label = "Sent to" }: {
  companies: Company[];
  preselected?: string[];
  /** People copied in — kept informed, and never asked for anything. */
  preselectedCopies?: string[];
  /** What the list is called: who it goes to, or, for what we received, who it is for. */
  label?: string;
}) {
  const companyOf = (personId: string) => companies.find((c) => c.people.some((p) => p.id === personId))?.key ?? "";
  const start = [
    ...preselected.map((id) => ({ company: companyOf(id), personId: id, copy: false })),
    ...preselectedCopies.map((id) => ({ company: companyOf(id), personId: id, copy: true })),
  ];
  const [rows, setRows] = useState<{ company: string; personId: string; copy: boolean }[]>(
    start.length ? start : [{ company: companies[0]?.key ?? "", personId: "", copy: false }],
  );
  const set = (i: number, patch: Partial<{ company: string; personId: string; copy: boolean }>) =>
    setRows((r) => r.map((row, n) => (n === i ? { ...row, ...patch } : row)));
  const field = "plain w-full py-1.5 text-[13px]";

  return (
    <div>
      <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="stencil text-slate-500">{label}<span className="ml-0.5 text-red-500">*</span></span>
        <span className="text-[11px] text-slate-400">everyone named here can open it and the documents it carries</span>
      </p>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {rows.map((row, i) => {
          const company = companies.find((c) => c.key === row.company);
          const people = company?.people ?? [];
          return (
            <li key={i} className="px-3 py-2.5">
              <div className="grid grid-cols-1 items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_7rem_2rem]">
                <label className="min-w-0">
                  <span className="sr-only">Company</span>
                  <select aria-label="Company" className={field} value={row.company} onChange={(e) => set(i, { company: e.target.value, personId: "" })}>
                    <option value="" disabled>Company…</option>
                    {companies.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                  </select>
                </label>
                <label className="min-w-0">
                  <span className="sr-only">Person</span>
                  <select aria-label="Person" name={row.copy ? "copyUsers" : "recipientUsers"} className={field} value={row.personId} onChange={(e) => set(i, { personId: e.target.value })}>
                    <option value="">Person…</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.job ? ` — ${p.job}` : ""}</option>)}
                  </select>
                </label>
                {/* Asked, or only kept informed. Said in a word, because it
                    changes what the transmittal means for that person — and
                    because "seen" is read from the first kind only. */}
                <label className="min-w-0">
                  <span className="sr-only">Asked, or copied in</span>
                  <select
                    aria-label="Asked, or copied in"
                    className={field}
                    value={row.copy ? "cc" : "to"}
                    onChange={(event) => set(i, { copy: event.target.value === "cc" })}
                    title="Addressed: asked to do something with it, and the ones “seen” is read from. Copy: kept informed, never asked."
                  >
                    <option value="to">Addressed</option>
                    <option value="cc">Copy</option>
                  </select>
                </label>
                {rows.length > 1 ? (
                  <button type="button" onClick={() => setRows((r) => r.filter((_, n) => n !== i))} className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-tint-soft hover:text-slate-700" aria-label="Remove this recipient">
                    <X className="h-4 w-4" />
                  </button>
                ) : <span />}
              </div>
              {company?.offline ? (
                <p className="mt-1.5 text-[11px] text-slate-500">Not on this system — {company.offline} sends it to them and records the proof.</p>
              ) : null}
              {people.length === 0 && row.company ? (
                <p className="mt-1.5 text-[11px] text-amber-700">Nobody from this company has an account yet — add them in People &amp; access.</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => setRows((r) => [...r, { company: r[r.length - 1]?.company ?? companies[0]?.key ?? "", personId: "", copy: false }])}
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-link hover:underline"
      >
        <Plus className="h-3.5 w-3.5" /> Another recipient
      </button>
    </div>
  );
}
