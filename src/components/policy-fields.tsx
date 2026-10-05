import { Field, inputCls } from "@/components/ui";
import type { OwnField, Rules } from "@/lib/field-policy";

/**
 * A form drawn the way the organization asked for it.
 *
 * `Asked` wraps one of the application's own fields: it disappears when the
 * organization does not ask for it, carries its own word for it, and marks it
 * required when it insists. `Added` draws the fields the organization made for
 * itself, under `own:<key>` so an action can take them without knowing their
 * names.
 *
 * Both are server components: nothing here needs a browser, and a form that
 * renders on the server cannot disagree with the action that receives it.
 */
export function Asked({
  policy,
  field,
  children,
  hint,
  className,
  force,
}: {
  policy: { rules: Rules; labels: Record<string, string> };
  field: string;
  children: (asked: { required: boolean; label: string }) => React.ReactNode;
  hint?: string;
  className?: string;
  /** Required whatever the policy says — a number built from it, say. */
  force?: boolean;
}) {
  const rule = policy.rules[field];
  if (rule === "OFF" && !force) return null;
  const required = force || rule === "REQUIRED";
  const label = policy.labels[field] ?? field;
  return (
    <Field label={label} required={required} hint={hint} className={className}>
      {children({ required, label })}
    </Field>
  );
}

/** The fields this organization added, in the order it put them. */
export function Added({ fields, values, className }: { fields: OwnField[]; values?: Record<string, string>; className?: string }) {
  if (!fields.length) return null;
  return (
    <>
      {fields.map((field) => {
        const name = `own:${field.key}`;
        const value = values?.[field.key] ?? "";
        const required = field.rule === "REQUIRED";
        return (
          <Field key={field.key} label={field.label} required={required} hint={field.help ?? undefined} className={className}>
            {field.control === "LONG_TEXT" ? (
              <textarea name={name} required={required} defaultValue={value} rows={3} className={inputCls} />
            ) : field.control === "CHOICE" ? (
              <select name={name} required={required} defaultValue={value} className={inputCls}>
                <option value="">{required ? "Choose…" : "—"}</option>
                {(field.options ?? []).map((o) => (
                  <option key={o.code} value={o.code}>{o.label}</option>
                ))}
              </select>
            ) : field.control === "YES_NO" ? (
              <select name={name} required={required} defaultValue={value} className={inputCls}>
                <option value="">{required ? "Choose…" : "—"}</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            ) : (
              <input
                name={name}
                required={required}
                defaultValue={value}
                type={field.control === "DATE" ? "date" : field.control === "NUMBER" ? "number" : "text"}
                maxLength={field.control === "TEXT" ? 200 : undefined}
                className={inputCls}
              />
            )}
          </Field>
        );
      })}
    </>
  );
}
