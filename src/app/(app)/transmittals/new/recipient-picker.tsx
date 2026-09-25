"use client";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";
import { Plus, X } from "lucide-react";

export type Company = { key: string; name: string; people: { id: string; name: string; job?: string | null }[] };

/**
 * Who receives it, chosen rather than typed: a company, then a person in that
 * company. A transmittal is evidence that named people were told, so a name
 * nobody can be matched to is worth nothing — and everyone named here can open
 * the transmittal and the documents it carries.
 */
export function RecipientPicker({ companies, preselected = [] }: { companies: Company[]; preselected?: string[] }) {
  const companyOf = (personId: string) => companies.find((c) => c.people.some((p) => p.id === personId))?.key ?? "";
  const [rows, setRows] = useState<{ company: string; personId: string }[]>(
    preselected.length ? preselected.map((id) => ({ company: companyOf(id), personId: id })) : [{ company: companies[0]?.key ?? "", personId: "" }],
  );
  const set = (i: number, patch: Partial<{ company: string; personId: string }>) =>
    setRows((r) => r.map((row, n) => (n === i ? { ...row, ...patch } : row)));

  return (
    <Field label="Sent to" required hint="a person, at a company — they will be able to open it">
      <div className="space-y-2">
        {rows.map((row, i) => {
          const people = companies.find((c) => c.key === row.company)?.people ?? [];
          return (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Company"
                className={`${inputCls} w-full sm:w-52`}
                value={row.company}
                onChange={(e) => set(i, { company: e.target.value, personId: "" })}
              >
                <option value="" disabled>Company…</option>
                {companies.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              </select>
              <select
                aria-label="Person"
                name="recipientUsers"
                className={`${inputCls} w-full sm:w-64`}
                value={row.personId}
                onChange={(e) => set(i, { personId: e.target.value })}
              >
                <option value="">Person…</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.job ? ` — ${p.job}` : ""}</option>)}
              </select>
              {people.length === 0 && row.company ? (
                <span className="text-[11px] text-amber-700">Nobody from this company has an account yet — add them in People &amp; access.</span>
              ) : null}
              {rows.length > 1 ? (
                <button type="button" onClick={() => setRows((r) => r.filter((_, n) => n !== i))} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Remove this recipient">
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => setRows((r) => [...r, { company: r[r.length - 1]?.company ?? companies[0]?.key ?? "", personId: "" }])}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-surface px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Plus className="h-3.5 w-3.5" /> Another recipient
        </button>
      </div>
    </Field>
  );
}
