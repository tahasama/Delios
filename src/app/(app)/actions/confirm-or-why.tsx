"use client";

import { useState } from "react";
import { Field, inputCls } from "@/components/ui";

/**
 * The uploader vouches that the file is the released revision — ticked to
 * start with. Only when they untick it must they say why it differs.
 */
export function ConfirmOrWhy({ revision }: { revision: string }) {
  const [vouched, setVouched] = useState(true);
  return (
    <>
      <label className="flex items-start gap-2 text-xs leading-5 text-slate-700">
        <input type="checkbox" name="confirmed" value="yes" checked={vouched} onChange={(event) => setVouched(event.target.checked)} className="mt-0.5" />
        <span>This file is {revision} as released; I take responsibility for it matching.</span>
      </label>
      {vouched ? null : (
        <Field label="It differs from the released revision — why" required hint="kept in the activity log">
          <input name="reason" required className={inputCls} placeholder="e.g. The approver is away; the stamped scan follows" />
        </Field>
      )}
    </>
  );
}
