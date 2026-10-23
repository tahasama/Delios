"use client";

import { useState } from "react";
import { Select } from "@/components/select";
import { Field } from "@/components/ui";

type P6Project = { id: string; code: string; activities: number };

/** The projects a P6 export holds, with how many activities each, read from its PROJECT and TASK tables. */
function projectsOf(text: string): P6Project[] {
  const projects = new Map<string, P6Project>();
  let table = "";
  let fields: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("%T\t")) { table = line.slice(3).trim(); fields = []; }
    else if (line.startsWith("%F\t")) fields = line.slice(3).split("\t");
    else if (line.startsWith("%R\t")) {
      const row = line.slice(3).split("\t");
      const cell = (name: string) => (row[fields.indexOf(name)] ?? "").trim();
      if (table === "PROJECT" && cell("proj_id")) projects.set(cell("proj_id"), { id: cell("proj_id"), code: cell("proj_short_name") || cell("proj_id"), activities: 0 });
      else if (table === "TASK" && cell("task_type") !== "TT_WBS") {
        const p = projects.get(cell("proj_id"));
        if (p) p.activities++;
      }
    } else if (line.startsWith("%E")) break;
  }
  return [...projects.values()].filter((p) => p.activities > 0);
}

/**
 * The schedule's file (owner: an .xer can hold several projects, a baseline among them): an Excel, a CSV or a Primavera
 * P6 export. An export of several projects asks which one is the schedule, the one named as our project chosen first;
 * the choice is kept for the schedule's next revisions (backend `ScheduleImporter.ReadUploadAsync`).
 */
export function ScheduleFile({ accept, label, projectCode, className }: { accept: string; label: string; projectCode: string; className?: string }) {
  const [projects, setProjects] = useState<P6Project[]>([]);
  return (
    <>
      <input type="file" name="file" required accept={accept} aria-label={label} className={className}
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          if (!file || !/\.xer$/i.test(file.name)) { setProjects([]); return; }
          setProjects(projectsOf(await file.text()));
        }} />
      {projects.length > 1 ? (
        <Field label="Which P6 project is the schedule" required hint={`the export holds ${projects.length}; kept for its next revisions`}>
          <Select name="p6Project" required defaultValue={projects.find((p) => p.code.toLowerCase() === projectCode.toLowerCase())?.code ?? ""} className="plain w-full">
            <option value="" disabled>Choose…</option>
            {projects.map((p) => <option key={p.id} value={p.code}>{p.code} · {p.activities.toLocaleString("en-GB")} activities</option>)}
          </Select>
        </Field>
      ) : null}
    </>
  );
}
