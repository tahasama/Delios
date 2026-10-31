"use client";

import { useEffect } from "react";

const CHOSEN = ':is([aria-current="page"], [aria-current="true"], [aria-pressed="true"], [aria-selected="true"])';

/**
 * The switches slide (owner: "the switch tabs do not feel like switches, it should feel like a slide"): every `.seg`
 * gets one raised thumb, drawn by the stylesheet (`.seg[data-thumb]::before`), that this places under the chosen
 * segment and moves to the next one. Pressed, it slides at once to the segment pressed, before the page answers; the
 * answer confirms it. Mounted once, it follows every switch on every page (new ones, a choice changed, a width
 * changed). Without it, or for whoever asked for less motion, the chosen segment is raised as before.
 */
export function SegSlider() {
  useEffect(() => {
    const watched = new WeakSet<Element>();
    const sizes = new ResizeObserver((entries) => entries.forEach((e) => place(e.target as HTMLElement)));
    let frame = 0;
    let stale: number | undefined;
    // A press waiting for the page to answer: which switch, the address it was pressed at, and where it leads.
    let pending: { seg: HTMLElement; href: string; to: string | null } | null = null;
    // An address without its fragment: a segment's link and the address it leads to read the same.
    const bare = (href: string) => { const u = new URL(href, location.href); u.hash = ""; return u.href; };
    const letGo = (seg: HTMLElement) => {
      seg.querySelectorAll("[data-pick]").forEach((p) => p.removeAttribute("data-pick"));
      if (pending?.seg === seg) pending = null;
      window.clearTimeout(stale);
      place(seg);
    };

    function place(seg: HTMLElement, to?: HTMLElement | null) {
      const one = to ?? seg.querySelector<HTMLElement>(".segment[data-pick]") ?? seg.querySelector<HTMLElement>(`.segment${CHOSEN}`);
      if (!one || !one.offsetWidth) { seg.removeAttribute("data-thumb"); return; }
      const s = seg.getBoundingClientRect(), r = one.getBoundingClientRect();
      seg.style.setProperty("--thumb-x", `${r.left - s.left + seg.scrollLeft - seg.clientLeft}px`);
      seg.style.setProperty("--thumb-y", `${r.top - s.top + seg.scrollTop - seg.clientTop}px`);
      seg.style.setProperty("--thumb-w", `${r.width}px`);
      seg.style.setProperty("--thumb-h", `${r.height}px`);
      // Placed first where it stands, then free to slide: a switch that just appeared does not slide in from the left.
      if (!seg.hasAttribute("data-thumb")) {
        seg.setAttribute("data-thumb", "still");
        requestAnimationFrame(() => requestAnimationFrame(() => seg.setAttribute("data-thumb", "on")));
      }
    }
    function all() {
      frame = 0;
      document.querySelectorAll<HTMLElement>(".seg").forEach((seg) => {
        if (!watched.has(seg)) { watched.add(seg); sizes.observe(seg); }
        place(seg);
      });
    }
    const soon = () => { if (!frame) frame = requestAnimationFrame(all); };

    const changes = new MutationObserver((records) => {
      for (const m of records) {
        // The page answered: what it now marks chosen stands, and a press waiting for it is done.
        if (m.type === "attributes") m.target instanceof Element && m.target.closest(".seg")?.querySelectorAll("[data-pick]").forEach((p) => p.removeAttribute("data-pick"));
      }
      // The address moved. Where the segment leads: the thumb stays on it while the page answers (a choice that first
      // asks why keeps it there while it asks), and the next move of the address settles it, on what the page then
      // marks chosen (Cancel: back to what stands). Anywhere else (a refusal): back to what stands at once.
      if (pending && bare(location.href) !== pending.href) {
        if (pending.to && bare(location.href) === pending.to) {
          window.clearTimeout(stale);
          pending = { seg: pending.seg, href: bare(location.href), to: null };
        } else letGo(pending.seg);
      }
      soon();
    });
    changes.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-current", "aria-pressed", "aria-selected"] });

    const press = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const one = (e.target as Element | null)?.closest<HTMLElement>(".seg .segment");
      const seg = one?.closest<HTMLElement>(".seg");
      if (!one || !seg || one.getAttribute("aria-disabled") === "true") return;
      // Pressing what really stands (a plain mark, not a link) takes back a press still waiting: the switch comes back.
      if (one.matches(CHOSEN)) { if (seg.querySelector("[data-pick]")) letGo(seg); return; }
      if (!one.matches("a, button")) return;
      seg.querySelectorAll("[data-pick]").forEach((p) => p.removeAttribute("data-pick"));
      one.setAttribute("data-pick", "");
      const link = one.getAttribute("href");
      pending = { seg, href: bare(location.href), to: link ? bare(link) : null };
      place(seg, one);
      // The page never answered (an address elsewhere, a refusal): it goes back to what is chosen.
      window.clearTimeout(stale);
      stale = window.setTimeout(() => letGo(seg), 8000);
    };
    document.addEventListener("click", press, true);
    window.addEventListener("resize", soon);
    void document.fonts?.ready.then(soon);
    all();
    return () => {
      changes.disconnect();
      sizes.disconnect();
      document.removeEventListener("click", press, true);
      window.removeEventListener("resize", soon);
      window.clearTimeout(stale);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
