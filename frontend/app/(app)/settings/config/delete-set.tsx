"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { deleteListAction } from "@/lib/settings/forms-lists";

/**
 * Deleting a set, as an icon beside the other things you do to one.
 *
 * It confirms first, and when the server refuses — a numbering scheme or a
 * review route still points at the set — it says which one, instead of looking
 * like a button that does nothing.
 */
export function DeleteSetButton({ setKey, title, count }: { setKey: string; title: string; count: number }) {
  const [state, formAction, pending] = useActionState(deleteListAction, undefined);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!confirm(`Delete “${title}” and its ${count} value(s)? None of them was ever used on this project; the log keeps it.`)) {
          event.preventDefault();
        }
      }}
      className="relative"
    >
      <input type="hidden" name="key" value={setKey} />
      <button
        type="submit"
        disabled={pending}
        title="Delete this list"
        aria-label="Delete this list"
        className="inline-flex rounded-sm p-1.5 text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      {state?.error ? (
        <p role="alert" className="absolute right-0 top-9 z-30 w-72 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 shadow-lg ring-1 ring-red-200">{state.error}</p>
      ) : null}
    </form>
  );
}
