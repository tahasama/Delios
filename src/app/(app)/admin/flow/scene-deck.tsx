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
 * The flow as a strip of scenes: the main line lit one scene at a time, the
 * details of the lit one underneath. Arrow keys and the hash move between them,
 * so a link to /admin/flow#review opens on Review.
 */
export function SceneDeck({ scenes, panels }: { scenes: Scene[]; panels: React.ReactNode[] }) {
  const [at, setAt] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  // Bring a scene to the middle of the strip, without moving the page.
  const centre = (index: number, smooth: boolean) => {
    const strip = track.current;
    const card = strip?.querySelectorAll<HTMLButtonElement>("[role=tab]")[index];
    if (!strip || !card) return card;
    strip.scrollTo({ left: card.offsetLeft - (strip.clientWidth - card.offsetWidth) / 2, behavior: smooth ? "smooth" : "auto" });
    return card;
  };

  const go = useCallback((index: number, focus = false) => {
    const next = Math.max(0, Math.min(scenes.length - 1, index));
    setAt(next);
    history.replaceState(null, "", `#${scenes[next].key}`);
    const card = centre(next, true);
    if (focus) card?.focus({ preventScroll: true });
  }, [scenes]);

  // Open on the scene the address names.
  useEffect(() => {
    const found = scenes.findIndex((one) => `#${one.key}` === window.location.hash);
    if (found > 0) {
      setAt(found);
      centre(found, false);
    }
  }, [scenes]);

  const scene = scenes[at];

  return (
    <div className="space-y-4">
      <section className="scene-deck" aria-label="The flow">
        <div className="scene-film" aria-hidden />
        <div className="flex items-center justify-between gap-3 px-5 pt-4 sm:px-7">
          <p className="scene-kicker">The main line · {scenes.length} scenes</p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => go(at - 1)} disabled={at === 0} className="scene-nav" aria-label="Previous scene"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => go(at + 1)} disabled={at === scenes.length - 1} className="scene-nav" aria-label="Next scene"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        <div
          ref={track}
          role="tablist"
          aria-label="Scenes"
          className="scene-track scroll-quiet"
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") { event.preventDefault(); go(at + 1, true); }
            if (event.key === "ArrowLeft") { event.preventDefault(); go(at - 1, true); }
          }}
        >
          {scenes.map((one, i) => (
            <button
              key={one.key}
              type="button"
              role="tab"
              id={`scene-${one.key}`}
              aria-selected={i === at}
              aria-controls={`panel-${one.key}`}
              tabIndex={i === at ? 0 : -1}
              onClick={() => go(i)}
              className={cn("scene", one.rail, i < at && "scene-past")}
            >
              <span className="scene-number">{String(i + 1).padStart(2, "0")}</span>
              <span className="scene-title">{one.title}</span>
              <span className="scene-tagline">{one.tagline}</span>
              <span className="scene-foot">
                <span className="flex items-center gap-1" title="Who carries out its acts">
                  {one.carriers.length
                    ? one.carriers.map((c, n) => <span key={n} className={cn("scene-dot", `scene-dot-${c}`)} />)
                    : <span className="scene-dot scene-dot-none" />}
                </span>
                <span>{one.sets ? `${one.sets} set${one.sets === 1 ? "" : "s"}` : "no sets"}</span>
              </span>
              {i < scenes.length - 1 ? <span className="scene-link" aria-hidden /> : null}
            </button>
          ))}
        </div>

        <div className="scene-progress" aria-hidden>
          <span style={{ width: `${((at + 1) / scenes.length) * 100}%` }} />
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-4 text-[11px] sm:px-7">
          <span className="scene-legend"><span className="scene-dot scene-dot-control" /> Document Control</span>
          <span className="scene-legend"><span className="scene-dot scene-dot-work" /> the people doing the work</span>
          <span className="scene-legend"><span className="scene-dot scene-dot-fixed" /> fixed</span>
          <span className="scene-legend"><span className="scene-dot scene-dot-off" /> skipped</span>
        </p>
      </section>

      <div
        key={scene.key}
        role="tabpanel"
        id={`panel-${scene.key}`}
        aria-labelledby={`scene-${scene.key}`}
        className="scene-panel"
      >
        {panels[at]}
      </div>
    </div>
  );
}
