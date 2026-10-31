"use client";

import { useState } from "react";
import { Switch } from "@/components/switch";
import { ActionForm } from "@/components/form";
import { Field } from "@/components/ui";
import { askReaderAction } from "@/lib/settings/forms-viewers";

/**
 * A reader not installed here: its switch, pressed, opens the ask to DELIOS under its line (owner: "switching on opens
 * the form request"), with what was last asked.
 */
export function AskReader({ what, title, asked }: { what: string; title: string; asked: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Switch on={false} label={`Ask DELIOS for ${title}`} words={["On", open ? "Asking…" : "Ask for it"]} onToggle={() => setOpen((was) => !was)} />
      {asked ? <span className="text-[11px] text-slate-500">{asked}</span> : null}
      {open ? (
        <div className="mt-2 w-full min-w-72 sm:w-96">
          <ActionForm action={askReaderAction} submitLabel="Ask DELIOS" resetOnSuccess className="space-y-2">
            <input type="hidden" name="what" value={what} />
            <Field label="Anything to add" hint="optional — how many files, which versions, files that must stay on our servers…">
              <textarea name="message" rows={3} maxLength={2000} className="plain w-full" />
            </Field>
          </ActionForm>
        </div>
      ) : null}
    </div>
  );
}
