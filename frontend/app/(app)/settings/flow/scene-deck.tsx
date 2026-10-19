"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/core/utils";

export type Scene = {
  key: string;
  title: string;
  tagline: string;
  /** The rail class that gives the scene its colour. */
  rail: string;
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
 * The flow as a row of steps on its band: one flow at a time, one step of it lit, and under the band that step's
 * panel (who does it, how it works here, where it is set up), changed right there. A fork stacks its steps in one
 * column, the one that ends hanging below; one that does not always happen is drawn dashed. Arrow keys and the hash
 * move between them: /settings/flow#receive/review.
 */
export function SceneDeck({ flows, panels }: { flows: Flow[]; panels: Record<string, React.ReactNode> }) {
  const [on, setOn] = useState(0);
  const [lit, setLit] = useState<string>(flows[0].columns[0][0].scene.key);
  const track = useRef<HTMLDivElement>(null);
  const deck = useRef<HTMLElement>(null);
  const flow = flows[on];
  // Reading order: column by column, top to bottom within one.
  const order = flow.columns.flat();
  const at = Math.max(0, order.findIndex((lane) => lane.scene.key === lit));

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
    // A link on this page to another flow or scene changes only the hash, and brings the flow into view.
    const followed = () => { follow(); if (/^#[a-z-]+\/[a-z-]+$/.test(window.location.hash)) deck.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };
    window.addEventListener("hashchange", followed);
    return () => window.removeEventListener("hashchange", followed);
  }, [flows]);

  const lane = order[at];

  return (
    <div className="space-y-4">
      <section ref={deck} className="scene-deck scroll-mt-24" aria-label="The flow">
        <div className="scroll-quiet flex gap-1 overflow-x-auto px-5 pt-5 sm:flex-wrap sm:px-6" role="group" aria-label="Which flow">
          {flows.map((one, i) => (
            <button key={one.key} type="button" onClick={() => pick(i)} aria-pressed={i === on} className="route-pick">
              {one.title}
            </button>
          ))}
        </div>
        <p className="scene-route px-5 pt-3 sm:px-6">
          {flow.from} <span aria-hidden className="scene-route-arrow">→</span> {flow.to}
        </p>

        <div
          ref={track}
          role="tablist"
          aria-label="Steps"
          className="scene-track scroll-quiet"
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); step(1, true); }
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); step(-1, true); }
          }}
        >
          {flow.columns.map((column, c) => {
            const compact = column.length > 1;
            const station = ({ scene: one, optional, end }: Lane, n: number) => {
              const number = `${String(c + 1).padStart(2, "0")}${compact ? "ab"[column.findIndex((l) => l.scene.key === one.key)] ?? "" : ""}`;
              return (
                <button
                  key={`${flow.key}/${one.key}/${n}`}
                  type="button"
                  role="tab"
                  data-scene={one.key}
                  id={`scene-${one.key}`}
                  aria-selected={one.key === lit}
                  aria-controls="scene-panel"
                  tabIndex={one.key === lit ? 0 : -1}
                  onClick={() => go(one.key)}
                  className={cn("scene", one.rail, optional && "scene-optional", end && "scene-end")}
                >
                  <span className="scene-number">
                    <span>{number}</span>
                    {end ? <span>{optional ? "optional · ends here" : "ends here"}</span> : optional ? <span>optional</span> : null}
                  </span>
                  <span className="scene-title">{one.title}</span>
                  <span className="scene-tagline">{optional ? `Only if ${optional}` : one.tagline}</span>
                </button>
              );
            };
            const main = column.filter((l) => !l.end);
            const ends = column.filter((l) => l.end);
            return (
              <div key={`${flow.key}/${c}`} className={cn("scene-col", c < flow.columns.length - 1 && "scene-col-linked")}>
                <div className="scene-band">{main.map(station)}</div>
                {ends.map((l, i) => <div key={l.scene.key} className="scene-branch">{station(l, main.length + i)}</div>)}
              </div>
            );
          })}
        </div>

        {/* The key: what each mark on the console means. */}
        <p className="scene-key px-5 pb-4 sm:px-6">
          <span><span className="scene-key-light" aria-hidden />the light on top: the state it leaves the document in, as in the register</span>
          <span><span className="scene-key-sometimes" aria-hidden />dashed: optional, only when it applies</span>
          <span><span className="scene-key-end" aria-hidden />below, in rose: the revision ends there, the next one starts again</span>
          <span><span className="scene-key-lit" aria-hidden />ringed: the step shown under the console</span>
        </p>
      </section>

      <div key={`${flow.key}/${lane.scene.key}`} role="tabpanel" id="scene-panel" aria-labelledby={`scene-${lane.scene.key}`} className="scene-panel">
        {lane.optional ? <p className="mb-2 text-xs text-slate-600">On this flow, only if {lane.optional}.</p> : null}
        {panels[lane.scene.key]}
      </div>
    </div>
  );
}
