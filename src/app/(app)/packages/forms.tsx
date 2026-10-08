"use client";

import { useActionState, useState } from "react";
import { addToPackageAction, createPackageAction, packageAction } from "@/lib/actions/package-acts";
import { SearchPick } from "@/components/search-pick";
import { btn, Field, inputCls } from "@/components/ui";
import { RuleFields, type Pick, type RuleLists } from "./rule-fields";

type Person = { id: string; name: string; function: string };
type Party = { id: string; name: string };

function Problem({ message }: { message?: string }) {
  return message ? <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p> : null;
}

const statusItems = (statuses: Pick[]) => statuses.map((s) => ({ id: s.code, name: s.code, detail: s.label }));

/** A new package: what it is, who it goes to, what each document must reach, who puts it together and who accepts it. */
export function CreateForm({ statuses, reasons, people, parties, rule, me }: {
  statuses: Pick[]; reasons: Pick[]; people: Person[]; parties: Party[]; rule: RuleLists; me: string;
}) {
  const [state, act, pending] = useActionState(createPackageAction, undefined);
  const [formKey] = useState(() => crypto.randomUUID());
  const who = people.map((p) => ({ id: p.id, name: p.name, detail: p.function }));
  return (
    <form action={act} className="space-y-4">
      <input type="hidden" name="formKey" value={formKey} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="Title" required hint="numbered when created" className="md:col-span-2"><input name="title" required className={inputCls} placeholder="Operations handover — pump house" /></Field>
        <Field label="Due" hint="optional"><input type="date" name="completionDate" className={inputCls} /></Field>
        <Field label="Description" hint="optional — what it is for" className="md:col-span-3"><textarea name="description" rows={2} className={inputCls} /></Field>
        <Field label="Why they get it" required>
          <select name="reason" required className={inputCls} defaultValue=""><option value="" disabled>Choose…</option>{reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</select>
        </Field>
        <SearchPick browse name="requiredStatus" required label="Needed at" hint="one or several — ready at any of them" items={statusItems(statuses)} />
        <SearchPick browse name="partyId" label="Delivered to" hint="optional — none: it is closed, not sent" items={parties.map((p) => ({ id: p.id, name: p.name }))} />
        <SearchPick name="ownerId" required label="Put together by" hint="one or several" initial={[me]} items={who} />
        <SearchPick name="acceptorId" required label="Accepted by" hint="not those putting it together — any one of them accepts" items={who} />
      </div>
      <div className="rounded-lg bg-tint-soft px-4 py-3">
        <p className="mb-3 flex flex-wrap items-baseline gap-x-2"><span className="stencil text-slate-500">Fills itself with</span><span className="text-[11px] text-slate-400">optional — every document matching all you choose joins, new ones too</span></p>
        <RuleFields lists={rule} />
      </div>
      <Problem message={state?.error} />
      <button type="submit" disabled={pending} className={btn("primary")}>{pending ? "Creating…" : "Create package"}</button>
    </form>
  );
}

/** The documents chosen in the register, into one open package. */
export function AddForm({ documentIds, packages, statuses }: { documentIds: string[]; packages: { id: string; name: string }[]; statuses: Pick[] }) {
  const [state, act, pending] = useActionState(addToPackageAction, undefined);
  return (
    <form action={act} className="space-y-3">
      {documentIds.map((id) => <input key={id} type="hidden" name="documentId" value={id} />)}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Package" required>
          <select name="packageId" required className={inputCls} defaultValue=""><option value="" disabled>Choose…</option>{packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </Field>
        <SearchPick browse name="requiredStatus" label="Needed at" hint="optional — empty: what the package needs" items={statusItems(statuses)} />
      </div>
      <Problem message={state?.error} />
      <button type="submit" disabled={pending} className={btn("primary", "sm")}>{pending ? "…" : `Add ${documentIds.length} document${documentIds.length === 1 ? "" : "s"}`}</button>
    </form>
  );
}

/** One step on a package's page. */
export function Step({ packageId, what, label, children, variant = "primary" }: {
  packageId: string; what: string; label: string; children?: React.ReactNode; variant?: "primary" | "secondary";
}) {
  const [state, act, pending] = useActionState(packageAction, undefined);
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="packageId" value={packageId} />
      <input type="hidden" name="what" value={what} />
      {children}
      {state ? state.ok
        ? <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{state.message}</p>
        : <p role="alert" className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{state.message}</p> : null}
      <button type="submit" disabled={pending} className={btn(variant, "sm")}>{pending ? "…" : label}</button>
    </form>
  );
}

