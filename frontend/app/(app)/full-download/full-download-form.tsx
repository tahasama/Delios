"use client";

import { useState } from "react";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { Select } from "@/components/select";
import { SwitchField } from "@/components/switch";
import { cn } from "@/lib/core/utils";
import { askFullDownloadAction } from "@/lib/documents/forms-full-download";
import { LEVELS } from "@/lib/documents/full-download-levels";

const LAYOUTS = [
  { code: "TREE", label: "The package tree", says: "each package inside the one it sits in; documents in no package in a folder of their own" },
  { code: "LEVELS", label: "Levels", says: "folders by the levels chosen, in their order" },
  { code: "FLAT", label: "Flat", says: "every document side by side, no folders" },
] as const;

/**
 * What the full download takes, how its folders are made and what goes with the files, chosen each time (owner). Who
 * may take the whole organization's is said by the page; the backend checks it, and what the person may read.
 */
export function FullDownloadForm({ project, mayTakeOrganization }: { project: string; mayTakeOrganization: boolean }) {
  const [layout, setLayout] = useState<(typeof LAYOUTS)[number]["code"]>("TREE");
  const [levels, setLevels] = useState<string[]>(["DISCIPLINE", "DOCTYPE"]);
  const chosen = LAYOUTS.find((one) => one.code === layout)!;
  const setLevel = (at: number, code: string) =>
    setLevels((all) => (code ? [...all.slice(0, at), code, ...all.slice(at + 1)] : all.slice(0, at)).filter((one, i, list) => list.indexOf(one) === i));

  return (
    <ActionForm action={askFullDownloadAction} submitLabel="Prepare the download">
      <input type="hidden" name="layout" value={layout} />
      {layout === "LEVELS" ? levels.map((one) => <input key={one} type="hidden" name="level" value={one} />) : null}
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
        <Field label="What it takes" hint={mayTakeOrganization ? "an administrator may take every project" : "the control function takes its project"}>
          <Select name="scope" defaultValue="project" className={inputCls}>
            <option value="project">{project}</option>
            {mayTakeOrganization ? <option value="organization">The whole organization (every project you are on)</option> : null}
          </Select>
        </Field>
        <Field label="Folders" hint={chosen.says}>
          <span className="choice" role="group" aria-label="How the folders are made">
            {LAYOUTS.map((one) => (
              <button key={one.code} type="button" aria-pressed={layout === one.code} onClick={() => setLayout(one.code)}
                className={cn("choice-side", layout === one.code && "choice-on")}>{one.label}</button>
            ))}
          </span>
        </Field>
      </div>
      {layout === "LEVELS" ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
          {[0, 1, 2, 3].filter((at) => at <= levels.length).map((at) => (
            <Field key={at} label={at === 0 ? "First folder" : "Then"} hint={at === 0 ? "the top folder" : "inside the one before"}>
              <Select value={levels[at] ?? ""} onChange={(e) => setLevel(at, e.target.value)} className={inputCls}>
                <option value="">{at === 0 ? "Choose…" : "Nothing more"}</option>
                {LEVELS.filter((one) => one.code === levels[at] || !levels.includes(one.code)).map((one) => <option key={one.code} value={one.code}>{one.label}</option>)}
              </Select>
            </Field>
          ))}
        </div>
      ) : null}
      <div>
        <p className="text-xs font-medium text-slate-700">With the files</p>
        <p className="mb-2 text-[11px] text-slate-500">Each document at its newest released revision: its PDF as released, stamped where it was, and its source file.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <SwitchField name="register" defaultChecked>The register, as Excel: every document in it and its folder</SwitchField>
          <SwitchField name="reviews" defaultChecked>Each review beside its document: verdicts, advice, comments</SwitchField>
          <SwitchField name="transmittals" defaultChecked>The transmittals, each as a letter</SwitchField>
          <SwitchField name="audit" defaultChecked>The audit trail, as Excel</SwitchField>
        </div>
      </div>
    </ActionForm>
  );
}
