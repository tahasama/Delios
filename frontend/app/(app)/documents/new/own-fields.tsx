"use client";

import { inputCls } from "@/components/ui";
import type { OwnField } from "@/lib/settings/field-policy";
import { forType, type Serving } from "@/lib/settings/serving";

/**
 * The fields this organization added, drawn as it asked for them.
 *
 * They are posted under `own:<key>` so the action can tell them from the
 * application's own fields without a list of exceptions, and so a field added
 * tomorrow needs no change here.
 */
export function OwnFields({ fields, values, className, deliverableType, serving }: {
  fields: OwnField[]; values?: Record<string, string>; className?: string;
  /** A list of one's own offers the values of the set serving this deliverable type (owner: forms follow the sets). */
  deliverableType?: string | null; serving?: Serving;
}) {
  if (!fields.length) return null;
  return (
    <>
      {fields.map((field) => {
        const name = `own:${field.key}`;
        const value = values?.[field.key] ?? "";
        const required = field.rule === "REQUIRED";
        return (
          <label key={field.key} className={`block min-w-0 ${className ?? ""}`}>
            <span className="mb-1.5 flex h-4 min-w-0 items-baseline gap-2 leading-4 overflow-hidden">
              <span className="stencil shrink-0 text-slate-500">
                {field.label}
                {required ? <span className="ml-0.5 text-red-500">*</span> : null}
              </span>
              {field.help ? <span className="min-w-0 truncate text-[11px] leading-4 text-slate-400" title={field.help}>{field.help}</span> : null}
            </span>

            {field.control === "LONG_TEXT" ? (
              <textarea name={name} required={required} defaultValue={value} rows={3} className={inputCls} />
            ) : field.control === "CHOICE" ? (
              <select name={name} required={required} defaultValue={value} className={inputCls}>
                <option value="">{required ? "Choose…" : "—"}</option>
                {(field.fromList && serving && field.setKey ? forType(serving, field.setKey, deliverableType, field.options ?? []) : field.options ?? []).map((o) => (
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
          </label>
        );
      })}
    </>
  );
}
