"use client";

/**
 * Ticks every row in the bulk form at once. The boxes belong to that form by id
 * rather than by nesting, so this reaches them through the form rather than
 * through the table.
 */
export function SelectAll({ formId, count }: { formId: string; count: number }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 font-medium text-slate-600">
      <input
        type="checkbox"
        aria-label={`Select all ${count} rows shown`}
        onChange={(event) => {
          const form = document.getElementById(formId) as HTMLFormElement | null;
          if (!form) return;
          for (const box of form.elements) {
            if (box instanceof HTMLInputElement && box.name === "valueIds") box.checked = event.target.checked;
          }
        }}
      />
      All {count} shown
    </label>
  );
}
