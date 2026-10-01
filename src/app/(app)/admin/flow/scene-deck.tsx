"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Scene = {
  key: string;
  title: string;
  tagline: string;
  /** The rail class that gives the scene its colour. */
  rail: string;
  /** How the acts of this step are carried: one mark per act. */
  carriers: ("control" | "work" | "fixed" | "off")[];
  states: string[];
  sets: number;
};

/**
 * A scene in its place on a flow; `optional` says when it happens at all, and
 * `end` marks the branch where this revision stops — it goes back, and the
 * next revision starts the flow again.
 */
export type Lane = { scene: Scene; optional?: string; end?: boolean };

/**
 * One flow a document goes through: its columns in order, and in a column
 * with more than one lane, scenes that run side by side.
 */
export type Flow = { key: string; title: string; from: string; to: string; columns: Lane[][] };

/**
 * The flow as a strip of scenes: one flow at a time, one scene of it lit, the
 * details of the lit one underneath. Scenes that run side by side are stacked
 * in one column; one that does not always happen is drawn dashed. Arrow keys
 * and the hash move between them: /admin/flow#receive/outside.
 */
export function SceneDeck({ flows, panels }: { flows: Flow[]; panels: Record<string, React.ReactNode> }) {
  const [on, setOn] = useState(0);
  const [lit, setLit] = useState<string>(flows[0].columns[0][0].scene.key);
  const track = useRef<HTMLDivElement>(null);
  const flow = flows[on];
  // Reading order: column by column, top to bottom within one.
  const order = flow.columns.flat();
  const at = Math.max(0, order.findIndex((lane) => lane.scene.key === lit));
  const lane = order[at];

  // Bring a scene to the middle of the strip, without moving the page.
  const centre = (key: string, smooth: boolean) => {
    const strip = track.current;
    const card = strip?.querySelector<HTMLButtonElement>(`[data-scene="${key}"]`);
    if (!strip || !card) return card;
    const column = card.parentElement as HTMLElement;
    strip.scrollTo({ left: column.offsetLeft - (strip.clientWidth - column.offsetWidth) / 2, behavior: smooth ? "smooth" : "auto" });
    return card;
  };

  const go = useCallback((key: string, focus = false) => {
    setLit(key);
    history.replaceState(null, "", `#${flow.key}/${key}`);
    const card = centre(key, true);
    if (focus) card?.focus({ preventScroll: true });
  }, [flow]);

  const step = (by: number, focus = false) => {
    const next = order[Math.max(0, Math.min(order.length - 1, at + by))];
    go(next.scene.key, focus);
  };

  // Another flow keeps the scene that was lit, where it has one.
  const pick = (index: number) => {
    const next = flows[index];
    const keep = next.columns.flat().some((one) => one.scene.key === lit) ? lit : next.columns[0][0].scene.key;
    setOn(index);
    setLit(keep);
    history.replaceState(null, "", `#${next.key}/${keep}`);
    requestAnimationFrame(() => centre(keep, true));
  };

  // Open on the flow and scene the address names: #flow/scene, or a scene alone.
  useEffect(() => {
    const follow = () => {
      const [first, second] = window.location.hash.slice(1).split("/");
      let f = flows.findIndex((one) => one.key === first);
      const key = f >= 0 ? second : first;
      if (f < 0) f = Math.max(0, flows.findIndex((one) => one.columns.flat().some((l) => l.scene.key === key)));
      const lanes = flows[f].columns.flat();
      const found = lanes.find((l) => l.scene.key === key) ?? lanes[0];
      setOn(f);
      setLit(found.scene.key);
      requestAnimationFrame(() => centre(found.scene.key, false));
    };
    follow();
    // A link on this page to another flow or scene changes only the hash.
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [flows]);

  return (
    <div className="space-y-4">
      <section className="scene-deck" aria-label="The flow">
        <div className="scene-film" aria-hidden />
        <div className="flex flex-wrap gap-1.5 px-5 pt-5 sm:px-7" role="group" aria-label="Flows">
          {flows.map((one, i) => (
            <button key={one.key} type="button" onClick={() => pick(i)} aria-pressed={i === on} className="route-pick">
              {one.title}
            </button>
          ))}
        </div>
        <p className="scene-route px-5 pt-2.5 sm:px-7">
          <span>{flow.from}</span>
          <span className="scene-route-arrow" aria-hidden>→</span>
          <span>{flow.to}</span>
        </p>
        <div className="flex items-center justify-between gap-3 px-5 pt-3 sm:px-7">
          <p className="scene-kicker">{flow.title} · {flow.columns.length} steps</p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => step(-1)} disabled={at === 0} className="scene-nav" aria-label="Previous scene"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => step(1)} disabled={at === order.length - 1} className="scene-nav" aria-label="Next scene"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        <div
          ref={track}
          role="tablist"
          aria-label="Scenes"
          className="scene-track scroll-quiet"
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); step(1, true); }
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); step(-1, true); }
          }}
        >
          {flow.columns.map((column, c) => {
            const main = column.filter((lane) => !lane.end);
            const ends = column.filter((lane) => lane.end);
            // A column that forks keeps its cards half height, so the branch
            // that carries on stays on the line and the one that ends hangs below.
            const compact = column.length > 1;
            const card = ({ scene: one, optional, end }: Lane, lane: number) => {
              const index = order.findIndex((l) => l.scene.key === one.key);
              const number = `${String(c + 1).padStart(2, "0")}${compact ? "ab"[column.findIndex((l) => l.scene.key === one.key)] ?? "" : ""}`;
              return (
                <button
                  key={`${flow.key}/${one.key}/${lane}`}
                  type="button"
                  role="tab"
                  data-scene={one.key}
                  id={`scene-${one.key}`}
                  aria-selected={one.key === lit}
                  aria-controls={`panel-${one.key}`}
                  tabIndex={one.key === lit ? 0 : -1}
                  onClick={() => go(one.key)}
                  className={cn("scene", one.rail, index < at && "scene-past", optional && "scene-optional", compact && "scene-compact", end && "scene-end")}
                >
                  <span className="scene-number">{number}{end ? " · ends" : optional ? " · optional" : ""}</span>
                  <span className="scene-title">{one.title}</span>
                  <span className="scene-tagline">{optional && !end && !compact ? `If ${optional}` : one.tagline}</span>
                  {compact ? null : (
                    <span className="scene-foot">
                      <span className="flex items-center gap-1" title="Who carries out its acts">
                        {one.carriers.length
                          ? one.carriers.map((mark, n) => <span key={n} className={cn("scene-dot", `scene-dot-${mark}`)} />)
                          : <span className="scene-dot scene-dot-none" />}
                      </span>
                      <span>{one.sets ? `${one.sets} set${one.sets === 1 ? "" : "s"}` : "no sets"}</span>
                    </span>
                  )}
                </button>
              );
            };
            return (
              <div key={`${flow.key}/${c}`} className={cn("scene-col", c < flow.columns.length - 1 && "scene-col-linked")}>
                <div className={cn("scene-band", main.length > 1 && "scene-fork")}>
                  {main.length > 1 ? <span className="scene-fork-label">side by side</span> : null}
                  {main.map(card)}
                </div>
                {ends.map((lane, i) => (
                  <div key={lane.scene.key} className="scene-branch">{card(lane, main.length + i)}</div>
                ))}
              </div>
            );
          })}
        </div>

        <div className="scene-progress" aria-hidden>
          <span style={{ width: `${((at + 1) / order.length) * 100}%` }} />
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-4 text-[11px] sm:px-7">
          <span className="scene-legend"><span className="scene-dot scene-dot-control" /> Document Control</span>
          <span className="scene-legend"><span className="scene-dot scene-dot-work" /> the people doing the work</span>
          <span className="scene-legend"><span className="scene-dot scene-dot-fixed" /> fixed</span>
          <span className="scene-legend"><span className="scene-dot scene-dot-off" /> skipped</span>
          <span className="scene-legend"><span className="scene-legend-dashed" /> only when it applies</span>
        </p>
      </section>

      <div
        key={`${flow.key}/${lane.scene.key}`}
        role="tabpanel"
        id={`panel-${lane.scene.key}`}
        aria-labelledby={`scene-${lane.scene.key}`}
        className="scene-panel"
      >
        {lane.optional ? <p className="mb-2 text-xs text-slate-500">On this flow, only if {lane.optional}.</p> : null}
        {panels[lane.scene.key]}
      </div>
    </div>
  );
}
