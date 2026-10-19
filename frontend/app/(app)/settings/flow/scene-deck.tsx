"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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
 * The flow as a row of steps: one flow at a time, one step of it lit, what it
 * decides underneath. A fork stacks its steps in one column, the one that ends
 * hanging below; one that does not always happen is drawn dashed. Arrow keys
 * and the hash move between them: /settings/flow#receive/review.
 */
/** One step as its row in the flow's table: who does what there, and where it is set up. */
export type StepRow = {
  who: { title: string; answer: string; href: string | null }[];
  links: { title: string; figure: string; href: string; warn: boolean }[];
};

export function SceneDeck({ flows, rows }: { flows: Flow[]; rows: Record<string, StepRow> }) {
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

  return (
    <div className="space-y-4">
      <section ref={deck} className="scroll-mt-24 overflow-hidden rounded-[0.875rem] bg-tint-soft ring-1 ring-line" aria-label="The flow">
        <div className="space-y-2 px-5 pt-4 pb-3 sm:px-6">
          <div className="seg w-fit max-w-full flex-wrap sm:flex-nowrap" role="group" aria-label="Which documents">
            {flows.map((one, i) => (
              <button key={one.key} type="button" onClick={() => pick(i)} aria-pressed={i === on} className="segment">
                {one.title}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-600">
            {flow.from} <span aria-hidden className="text-slate-400">→</span> {flow.to}
          </p>
        </div>

        <div
          ref={track}
          aria-label="Steps"
          className="scene-track scroll-quiet pt-3"
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); step(1, true); }
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); step(-1, true); }
          }}
        >
          {flow.columns.map((column, c) => {
            const main = column.filter((lane) => !lane.end);
            const ends = column.filter((lane) => lane.end);
            const compact = column.length > 1;
            const card = ({ scene: one, optional, end }: Lane, lane: number) => {
              const number = `${c + 1}${compact ? "ab"[column.findIndex((l) => l.scene.key === one.key)] ?? "" : ""}`;
              return (
                <button
                  key={`${flow.key}/${one.key}/${lane}`}
                  type="button"
                  data-scene={one.key}
                  id={`scene-${one.key}`}
                  aria-pressed={one.key === lit}
                  aria-controls={`row-${one.key}`}
                  onClick={() => go(one.key)}
                  className={cn("scene", one.rail, optional && "scene-optional", end && "scene-end")}
                >
                  <span className="scene-number">{number}{end ? " · ends here" : optional ? " · sometimes" : ""}</span>
                  <span className="scene-title">{one.title}</span>
                  <span className="scene-tagline">{optional && !end ? `If ${optional}` : one.tagline}</span>
                </button>
              );
            };
            return (
              <div key={`${flow.key}/${c}`} className={cn("scene-col", c < flow.columns.length - 1 && "scene-col-linked")}>
                <div className="scene-band">
                  {main.map(card)}
                </div>
                {ends.map((lane, i) => (
                  <div key={lane.scene.key} className="scene-branch">{card(lane, main.length + i)}</div>
                ))}
              </div>
            );
          })}
        </div>

        {/* The whole flow at once: every step a row, the lit one tinted. */}
        <div className="border-t border-line">
          <div className="hidden grid-cols-[13rem_minmax(0,1.3fr)_minmax(0,1fr)] gap-x-6 border-b border-line px-5 py-2 md:grid sm:px-6">
            <span className="stencil text-slate-500">Step</span>
            <span className="stencil text-slate-500">Who does it</span>
            <span className="stencil text-slate-500">Set up in</span>
          </div>
          <ol className="divide-y divide-line">
            {flow.columns.flatMap((column, c) => {
              const compact = column.length > 1;
              return [...column.filter((l) => !l.end), ...column.filter((l) => l.end)].map(({ scene: one, optional, end }) => {
                const row = rows[one.key];
                const number = `${c + 1}${compact ? "ab"[column.findIndex((l) => l.scene.key === one.key)] ?? "" : ""}`;
                return (
                  <li
                    key={`${flow.key}/${one.key}`}
                    id={`row-${one.key}`}
                    onClick={() => go(one.key)}
                    className={cn(
                      "grid cursor-pointer grid-cols-1 gap-x-6 gap-y-1.5 px-5 py-3 transition-colors md:grid-cols-[13rem_minmax(0,1.3fr)_minmax(0,1fr)] sm:px-6",
                      one.key === lit ? "bg-tint" : "hover:bg-tint/50",
                    )}
                  >
                    <div className={cn("min-w-0", (end || (optional && compact)) && "md:pl-4")}>
                      <p className="flex items-baseline gap-2">
                        <span className="font-mono text-[11px] text-slate-500">{number}</span>
                        <span className={cn("text-[13px] font-semibold", end ? "text-red-800 dark:text-red-300" : "text-slate-900")}>{one.title}</span>
                      </p>
                      <p className="text-xs leading-5 text-slate-500">
                        {end ? "ends here" : optional ? `only if ${optional}` : one.tagline}
                      </p>
                    </div>
                    <ul className="min-w-0 space-y-1">
                      {row?.who.map((who) => (
                        <li key={who.title} className="text-[13px] leading-5">
                          <span className="text-slate-500">{who.title}: </span>
                          {who.href ? (
                            <Link href={who.href} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-900 hover:text-link hover:underline">{who.answer}</Link>
                          ) : (
                            <span className="font-medium text-slate-900">{who.answer}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] leading-5">
                      {row?.links.length ? row.links.map((one) => (
                        <span key={one.href} className="whitespace-nowrap">
                          <Link href={one.href} onClick={(e) => e.stopPropagation()} className="font-medium text-link hover:underline">{one.title}</Link>
                          {one.figure ? <span className={cn("ml-1 text-xs", one.warn ? "text-amber-800" : "text-slate-500")}>{one.figure}</span> : null}
                        </span>
                      )) : <span className="text-xs text-slate-500">nothing to set up</span>}
                    </p>
                  </li>
                );
              });
            })}
          </ol>
        </div>
      </section>

    </div>
  );
}
