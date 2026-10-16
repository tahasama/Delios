import { Field } from "@/components/ui";
import { fmtDate } from "@/lib/core/utils";
import { PROJECT_KINDS } from "@/lib/settings/profiles/kinds";

/** A field as on the new-document form: grey, no box, inside the sheet's `asking` body. */
const field = "plain w-full";

export type ProjectLine = {
  id: string; code: string; name: string; kind: string; contractRole: string; startDate: string; endDate: string | null;
  scopeStatement?: string; previousCode?: string | null; codeChangedByName?: string | null; codeChangedAt?: string | null;
};

/**
 * A project's line opened for editing, the same on the organization's Projects and on Settings → This project: name,
 * code (changed once in its life, for a mistake; then fixed and shown, not sent), type, our role, dates, scope.
 */
export function ProjectFields({ p, roles }: { p: ProjectLine; roles: { code: string; label: string }[] }) {
  const fixed = !!p.codeChangedAt;
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      <Field label="Project name" required hint="its own across DELIOS: no other project has it">
        <input name="name" required defaultValue={p.name} autoComplete="off" className={field} />
      </Field>
      <Field label="Code" required
        hint={fixed
          ? `fixed: changed once, from ${p.previousCode}, by ${p.codeChangedByName}, ${fmtDate(p.codeChangedAt!)}`
          : "changed once only, for a mistake; numbers already given keep the old code"}>
        {fixed
          ? <input defaultValue={p.code} disabled className={`${field} uppercase`} aria-label="Code (fixed)" />
          : <input name="code" required defaultValue={p.code} autoComplete="off" className={`${field} uppercase`} />}
      </Field>
      <Field label="Type" hint="affects defaults only, never the rules">
        <select name="kind" defaultValue={p.kind} className={field}>
          {PROJECT_KINDS.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
        </select>
      </Field>
      <Field label="Our role" hint="decides where approval sits">
        <select name="role" defaultValue={p.contractRole} className={field}>
          {roles.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
      </Field>
      <Field label="Start"><input type="date" name="startDate" defaultValue={p.startDate.slice(0, 10)} className={field} /></Field>
      <Field label="End" hint="planned completion"><input type="date" name="endDate" defaultValue={p.endDate?.slice(0, 10) ?? ""} className={field} /></Field>
      <Field label="Scope" hint="what it controls; blank for the standard wording" className="sm:col-span-2">
        <input name="scopeStatement" defaultValue={p.scopeStatement ?? ""} className={field} />
      </Field>
    </div>
  );
}
