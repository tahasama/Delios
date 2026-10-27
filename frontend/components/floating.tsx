"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/core/utils";

/**
 * A list that opens from a field, drawn over the page (owner: "drawers are blocked by their card… some show to the
 * side and create a horizontal scroll"): on the page's body, so no card, scrolling row or sheet cuts it; under its
 * field, or above it when the window has no room under it; held inside the window's width, so it never pushes the page
 * sideways. Followed as the page scrolls or the window changes. `panel` is the list's own box, for a click outside it.
 */
export function Floating({ anchor, panel, children, className, width = "anchor", room = 200, id, role, label }: {
  anchor: RefObject<HTMLElement | null>;
  panel: RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
  className?: string;
  /** "anchor": the field's width; "at-least": at least the field's, up to 28rem; a number: that many pixels. */
  width?: "anchor" | "at-least" | number;
  /** Under this many pixels below the field, it opens above when there is more room there. */
  room?: number;
  id?: string;
  role?: string;
  label?: string;
}) {
  const [at, setAt] = useState<React.CSSProperties | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const field = anchor.current;
      if (!field) return;
      const r = field.getBoundingClientRect();
      const across = document.documentElement.clientWidth, high = window.innerHeight;
      const below = high - r.bottom - 8, above = r.top - 8;
      const up = below < room && above > below;
      const widest = Math.min(width === "anchor" ? r.width : typeof width === "number" ? width : 448, across - 16);
      const drawn = Math.min(panel.current?.offsetWidth || r.width, widest);
      const sizing: React.CSSProperties =
        width === "anchor" ? { width: Math.min(r.width, across - 16) }
          : width === "at-least" ? { minWidth: Math.min(r.width, across - 16), maxWidth: widest }
            : { width: widest };
      setAt({
        position: "fixed",
        left: Math.max(8, Math.min(r.left, across - drawn - 8)),
        maxHeight: Math.max(120, Math.min(336, up ? above : below)),
        ...sizing,
        ...(up ? { bottom: high - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    place();
    // Once its own width is known, it is held inside the window.
    const again = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { cancelAnimationFrame(again); window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [anchor, panel, width, room]);
  return createPortal(
    <div ref={panel} id={id} role={role} aria-label={label}
      style={at ?? { position: "fixed", top: 0, left: 0, visibility: "hidden" }}
      className={cn("z-[60] flex flex-col overflow-hidden rounded-md bg-surface shadow-lg ring-1 ring-line", className)}>
      {children}
    </div>,
    document.body,
  );
}
