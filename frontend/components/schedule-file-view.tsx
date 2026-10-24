"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn, fmtDate } from "@/lib/core/utils";

type Activity = { code: string; name: string; wbs: string | null; type: string; start: string | null; finish: string | null; started: boolean; finished: boolean };
type Wbs = { id: string; parent: string | null; code: string; name: string; order: number };
type Project = { id: string; code: string; name: string; wbs: Wbs[]; activities: Activity[] };
type Outline = { projects: Project[]; cut: boolean; read: string | null; readId: string | null };

type Row = { kind: "wbs"; node: Wbs; depth: number; count: number } | { kind: "activity"; activity: Activity; depth: number };

/**
 * A Primavera P6 export (.xer) shown in the page (owner: "can i preview the xer content too?"): each project on its tab,
 * its activities under their WBS as P6 lays them out, each WBS folded open or shut, with the activity's ID, name, type,
 * start and finish as P6 shows them ("A" once it happened). Read by the backend the way the schedule reads it; nothing
 * is recalculated.
 */
export function ScheduleFileView({ fileId, name, zoom = 1 }: { fileId: string; name: string; zoom?: number }) {
  const [outline, setOutline] = useState<Outline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [shut, setShut] = useState<Set<string>>(new Set());
  useEffect(() => {
    let gone = false;
    fetch(`/api/files/${fileId}/schedule`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (gone) return;
        if (!r.ok) setError(body.error ?? "The export could not be shown.");
        else {
          // Opened on the project the schedule reads, so it counts what the plan counts.
          const outline = body as Outline;
          setOutline(outline);
          setAt(Math.max(0, outline.projects.findIndex((p) => p.id === outline.readId)));
        }
      })
      .catch(() => { if (!gone) setError("The export could not be shown."); });
    return () => { gone = true; };
  }, [fileId]);

  const project = outline?.projects[at] ?? null;
  // Every WBS element with what it holds beneath it, the activities under their element, in P6's order.
  const rows = useMemo<Row[]>(() => {
    if (!project) return [];
    const children = new Map<string | null, Wbs[]>();
    for (const w of project.wbs) children.set(w.parent, [...(children.get(w.parent) ?? []), w]);
    const known = new Set(project.wbs.map((w) => w.id));
    const under = new Map<string | null, Activity[]>();
    for (const a of project.activities) {
      const home = a.wbs && known.has(a.wbs) ? a.wbs : null;
      under.set(home, [...(under.get(home) ?? []), a]);
    }
    const count = (id: string): number =>
      (under.get(id)?.length ?? 0) + (children.get(id) ?? []).reduce((n, w) => n + count(w.id), 0);
    const out: Row[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const a of under.get(parent) ?? []) out.push({ kind: "activity", activity: a, depth });
      for (const w of (children.get(parent) ?? []).sort((x, y) => x.order - y.order)) {
        const n = count(w.id);
        if (n === 0) continue;
        out.push({ kind: "wbs", node: w, depth, count: n });
        if (!shut.has(w.id)) walk(w.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [project, shut]);

  if (error) return <p className="p-6 text-center text-xs text-slate-500">{error}</p>;
  if (!outline) return <p className="p-6 text-center text-xs text-slate-500">Opening {name}…</p>;

  const toggle = (id: string) => setShut((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const day = (d: string | null, happened: boolean) => (d ? `${fmtDate(d)}${happened ? " A" : ""}` : "");

  return (
    <div className="flex h-[70vh] min-h-120 flex-col bg-surface">
      {outline.read ? (
        <p className="border-b border-line bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">As the schedule: {outline.read}</p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <table style={zoom === 1 ? undefined : { zoom }} className="w-full border-separate border-spacing-0 text-[12px] text-slate-800">
          <thead className="sticky top-0 z-10 bg-tint text-left text-[11px] font-medium text-slate-500">
            <tr>
              <th className="border-b border-line px-2 py-1.5">Activity ID</th>
              <th className="border-b border-line px-2 py-1.5">Activity name</th>
              <th className="border-b border-line px-2 py-1.5">Type</th>
              <th className="border-b border-line px-2 py-1.5 text-right">Start</th>
              <th className="border-b border-line px-2 py-1.5 text-right">Finish</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => row.kind === "wbs" ? (
              <tr key={`w-${row.node.id}`} className="bg-tint-soft">
                <td colSpan={5} className="border-b border-line/70 py-1 pr-2" style={{ paddingLeft: 8 + row.depth * 16 }}>
                  <button type="button" onClick={() => toggle(row.node.id)} aria-expanded={!shut.has(row.node.id)}
                    className="inline-flex items-center gap-1 text-left font-semibold text-slate-800 hover:text-link">
                    {shut.has(row.node.id) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    <span className="font-mono text-[11px] text-slate-500">{row.node.code}</span> {row.node.name}
                    <span className="ml-1 text-[11px] font-normal text-slate-500">{row.count}</span>
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={`a-${row.activity.code}`} className="hover:bg-tint-soft">
                <td className="whitespace-nowrap border-b border-line/70 py-1 pr-2 font-mono text-[11px]" style={{ paddingLeft: 8 + row.depth * 16 + 18 }}>{row.activity.code}</td>
                <td className="border-b border-line/70 px-2 py-1">{row.activity.name}</td>
                <td className={cn("whitespace-nowrap border-b border-line/70 px-2 py-1 text-[11px] text-slate-500", row.activity.type.includes("milestone") && "text-slate-700")}>{row.activity.type}</td>
                <td className="whitespace-nowrap border-b border-line/70 px-2 py-1 text-right tabular-nums">{day(row.activity.start, row.activity.started)}</td>
                <td className="whitespace-nowrap border-b border-line/70 px-2 py-1 text-right tabular-nums">{day(row.activity.finish, row.activity.finished)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {outline.cut ? (
        <p className="border-t border-line bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">The first 20,000 activities of each project are shown. Download the file for the rest.</p>
      ) : null}
      <nav role="tablist" aria-label="Projects" className="scroll-thin flex shrink-0 items-center gap-0.5 overflow-x-auto border-t border-line bg-tint-soft px-2">
        {outline.projects.map((p, i) => (
          <button key={p.id} type="button" role="tab" aria-selected={i === at} onClick={() => setAt(i)}
            className={cn("-mt-px whitespace-nowrap border-t-2 px-3 py-1.5 text-[11px] font-semibold transition",
              i === at ? "border-brand-line bg-surface text-brand-ink" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {p.code}<span className="ml-1 font-normal text-slate-400">{p.activities.length}</span>
            {outline.projects.length > 1 && p.id === outline.readId ? <span className="ml-1 font-normal text-emerald-700">· the schedule</span> : null}
          </button>
        ))}
        <span className="ml-auto px-2 text-[11px] text-slate-500">A: the date happened</span>
      </nav>
    </div>
  );
}
