"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";
import { cn } from "@/lib/core/utils";
import { quickFindAction, type Found } from "@/lib/core/forms-find";

/** What the person may open, the menu's own words: the same as the side menu's (`NavPermissions`). */
type Perms = {
  canRead: boolean; canTransmit: boolean; canControl: boolean; canConfigure: boolean; canSettings: boolean; canCreate: boolean; external?: boolean;
};

type Hit = { key: string; group: string; label: string; detail?: string; href: string };

/** The pages the quick find opens by name, filtered by what the person may do, as the side menu is. */
function pagesFor(p: Perms): Hit[] {
  const pages: [string, string, string | undefined, boolean?][] = [
    ["Home", "/", "What is waiting on me"],
    ["Documents", "/documents", "The register", p.canRead],
    ["New document", "/documents/new", "Register a document", p.canCreate && !p.external],
    ["Schedule", "/schedule", "What is needed, and when"],
    ["Transmittals", "/transmittals", "Issue, receive, confirm", p.canTransmit || p.canControl || p.external],
    ["New transmittal", "/transmittals/new", undefined, (p.canTransmit || p.canControl) && !p.external],
    ["Reviews", "/reviews", undefined],
    ["Packages", "/packages", undefined],
    ["Assets & tags", "/assets", undefined, !p.external],
    ["Distribution matrix", "/distribution", undefined, p.canRead && !p.external],
    ["Reports", "/reports", undefined, p.canRead],
    ["Project directory", "/directory", "Who takes part"],
    ["Assurance", "/conformance/checks", undefined, p.canControl && !p.external],
    ["Import & export", "/import", undefined, (p.canControl || p.canConfigure || p.canCreate) && !p.external],
    ["Settings", "/settings", undefined, p.canSettings],
    ["Notifications", "/notifications", undefined],
    ["Help & orientation", "/guide", undefined],
    ["Your sign-in", "/account", undefined],
  ];
  return pages.filter(([, , , when]) => when !== false).map(([label, href, detail]) => ({ key: `page:${href}`, group: "Pages", label, detail, href }));
}

const GROUP: Record<Found["kind"], string> = { document: "Documents", transmittal: "Transmittals", action: "Actions", package: "Packages" };

/** "Ctrl K" or "⌘ K", as the keyboard in front of the person says it; Ctrl until the page knows. */
export function useShortcutWords(): string {
  const [words, setWords] = useState("Ctrl K");
  useEffect(() => { if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setWords("⌘ K"); }, []);
  return words;
}

/** Opens the quick find from anywhere (the top bar's search hint). */
export function openCommandMenu() {
  window.dispatchEvent(new Event("delios:command"));
}

/**
 * The quick find (owner, "command menu"): Ctrl K (⌘ K on a Mac) anywhere opens one box; typing finds pages by their
 * name at once, and documents, transmittals, actions and packages by their number or name through the backend
 * (`quickFindAction`). The arrows move, Enter opens, Escape or a click beside it closes. Mounted once in the layout.
 */
export function CommandMenu({ perms }: { perms: Perms }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const pages = useMemo(() => pagesFor(perms), [perms]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((was) => !was); }
    };
    const onAsk = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("delios:command", onAsk);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("delios:command", onAsk); };
  }, []);

  useEffect(() => {
    if (!open) return;
    setWords(""); setFound([]); setActive(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  // What the backend finds, a moment after the typing stops.
  useEffect(() => {
    if (!open) return;
    const q = words.trim();
    if (q.length < 2) { setFound([]); return; }
    let live = true;
    const wait = setTimeout(() => start(async () => {
      const result = await quickFindAction(q).catch(() => [] as Found[]);
      if (live) setFound(result);
    }), 200);
    return () => { live = false; clearTimeout(wait); };
  }, [words, open]);

  const lower = words.trim().toLowerCase();
  const hits: Hit[] = [
    ...pages.filter((p) => !lower || p.label.toLowerCase().includes(lower) || (p.detail ?? "").toLowerCase().includes(lower)).slice(0, lower ? 6 : 8),
    ...found.map((f) => ({ key: `${f.kind}:${f.href}`, group: GROUP[f.kind], label: f.label, detail: f.detail, href: f.href })),
  ];
  useEffect(() => { setActive((i) => Math.min(i, Math.max(0, hits.length - 1))); }, [hits.length]);

  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    setOpen(false);
    router.push(hit.href);
  };

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="no-print fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Find">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-900/40" />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl bg-surface shadow-[0_24px_48px_-12px_rgb(16_42_67/0.35)] ring-1 ring-line">
        <div className="relative border-b border-line px-1.5 py-2">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-5 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={input}
            value={words}
            onChange={(e) => { setWords(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
              else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(hits.length - 1, i + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); go(hits[active]); }
            }}
            placeholder="Find a page, a document, a transmittal, an action, a package…"
            aria-label="Find"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-hits"
            autoComplete="off"
            className="h-(--control-h) w-full bg-transparent pr-3 pl-10 text-(length:--control-text) text-slate-800 outline-none placeholder:text-slate-400"
          />
        </div>
        <ul id="command-hits" role="listbox" className="scroll-thin max-h-[min(60vh,26rem)] overflow-y-auto py-1.5">
          {hits.length === 0 ? (
            <li className="px-4 py-3 text-xs text-slate-500">{pending ? "Looking…" : lower.length < 2 ? "Type a number or a few words." : <>Nothing matches “{words.trim()}”. Fewer words, or part of a number, find more.</>}</li>
          ) : null}
          {hits.map((hit, i) => {
            const head = hit.group !== lastGroup ? hit.group : null;
            lastGroup = hit.group;
            return (
              <li key={hit.key} role="presentation">
                {head ? <p className="px-4 pt-2.5 pb-1 text-[11px] font-semibold text-slate-500">{head}</p> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(hit)}
                  className={cn("flex w-full items-center gap-3 px-4 py-2 text-left", i === active ? "bg-tint-soft" : "")}
                >
                  <span className={cn("shrink-0 text-[13px] font-semibold text-slate-800", hit.group !== "Pages" && "font-mono")}>{hit.label}</span>
                  {hit.detail ? <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{hit.detail}</span> : <span className="flex-1" />}
                  {i === active ? <CornerDownLeft aria-hidden className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : null}
                </button>
              </li>
            );
          })}
          {pending && hits.length ? <li className="px-4 py-2 text-[11px] text-slate-400">Looking…</li> : null}
        </ul>
        <p className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-slate-500">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> to move</span>
          <span><Kbd>Enter</Kbd> to open</span>
          <span><Kbd>Esc</Kbd> to close</span>
        </p>
      </div>
    </div>
  );
}

/** A key, as the keyboard shows it. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-canvas px-1 py-px font-sans text-[10px] font-semibold text-slate-600">{children}</kbd>;
}
