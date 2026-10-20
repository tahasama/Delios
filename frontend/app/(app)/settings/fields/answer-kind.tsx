"use client";
import { Select } from "@/components/select";

import { useState } from "react";
import { inputCls, Field } from "@/components/ui";

/**
 * What kind of answer a field of one's own takes, and the list it is chosen from: the list is chosen only for an
 * answer "chosen from a list" (owner), and is then required. Once answered, both stay as they are (sent hidden).
 */
export function AnswerKind({ controls, sets, control, setKey, fixed }: {
  controls: { value: string; label: string }[]; sets: { key: string; title: string }[];
  control: string; setKey: string; fixed: boolean;
}) {
  const [kind, setKind] = useState(control);
  const choice = kind === "CHOICE";
  return (
    <>
      <Field label="What kind of answer" hint={fixed ? "answered already: stays as it is" : undefined}>
        <Select name={fixed ? undefined : "control"} value={kind} onChange={(e) => setKind(e.target.value)} disabled={fixed} className={inputCls}>
          {controls.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      </Field>
      <Field label="Which list" required={choice && !fixed} hint={fixed ? "answered already: stays as it is" : choice ? "the answer is one of its values" : "only for an answer chosen from a list"}>
        <Select key={choice ? "list" : "none"} name={fixed || !choice ? undefined : "setKey"} defaultValue={choice ? setKey : ""} disabled={fixed || !choice} required={choice && !fixed} className={inputCls}>
          <option value="">{choice ? "Choose a list" : "Not a list"}</option>
          {sets.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
        </Select>
      </Field>
    </>
  );
}
