"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/core/utils";
import { savePreference } from "@/lib/core/preferences";

/**
 * A column the person drags wider or narrower by its edge (owner: "make it resizable"); double-click puts it back. Its
 * width is a display preference, kept in a cookie the server reads (`initial`), so the page arrives at that width. It
 * never grows past its row: what stands beside it goes under it once there is no room left.
 */
export function ResizablePane({ name, initial, min = 240, edge = "right", className, children }: {
  name: string; initial: number | null; min?: number; edge?: "left" | "right"; className?: string; children: React.ReactNode;
}) {
  const [width, setWidth] = useState<number | null>(initial);
  const box = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const start = e.clientX;
    const from = box.current?.getBoundingClientRect().width ?? min;
    const room = box.current?.parentElement?.getBoundingClientRect().width ?? Infinity;
    let w = from;
    document.body.classList.add("dt-resizing");
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start;
      w = Math.round(Math.min(room, Math.max(min, from + (edge === "right" ? dx : -dx))));
      setWidth(w);
    };
    const up = () => {
      document.body.classList.remove("dt-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      savePreference(name, String(w));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const reset = () => { setWidth(null); savePreference(name, ""); };

  return (
    <div ref={box} className={cn("relative max-w-full", className)} style={width ? { width, flex: "none" } : undefined}>
      {children}
      <div role="separator" aria-orientation="vertical" aria-label="Drag to resize" title="Drag to resize. Double-click to put it back."
        onPointerDown={onPointerDown} onDoubleClick={reset}
        className={cn("group/pane absolute inset-y-0 z-10 hidden w-3 cursor-col-resize md:block", edge === "right" ? "-right-2.5" : "-left-1.5")}>
        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded transition group-hover/pane:bg-link/70" />
      </div>
    </div>
  );
}

