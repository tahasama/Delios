"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { inputCls } from "@/components/ui";
import { cn } from "@/lib/core/utils";
import { findOursAction } from "@/lib/documents/forms-numbers";

type Found = { id: string; number: string; title: string; revision: string | null };

/**
 * Choosing which of our documents something that arrived is: found in the register by a few words, chosen from the
 * list (owner: numbering is never typed). The choice goes with the form as `documentId`.
 */
export function MatchDocument({ proposed }: { proposed?: Found | null }) {
  const [words, setWords] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [chosen, setChosen] = useState<Found | null>(proposed ?? null);
  // Lists on a click and narrows as one types (owner), like every search field.
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (chosen || !open) { setFound([]); return; }
    let live = true;
    const wait = setTimeout(() => { findOursAction(words).then((rows) => { if (live) setFound(rows); }); }, words ? 250 : 0);
    return () => { live = false; clearTimeout(wait); };
  }, [words, chosen, open]);
  useEffect(() => {
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  if (chosen) {
    return (
      <span className="flex min-w-0 items-center gap-2 text-xs text-slate-700">
        <input type="hidden" name="documentId" value={chosen.id} />
        <span className="font-mono font-semibold">{chosen.number}</span>
        <span className="truncate text-slate-500">{chosen.title}{chosen.revision ? ` · rev ${chosen.revision}` : ""}</span>
        <button type="button" onClick={() => { setChosen(null); setWords(""); }} className="text-[11px] font-semibold text-link hover:underline">another</button>
      </span>
    );
  }
  return (
    <span ref={box} className="relative block w-72">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
      <input value={words} onChange={(e) => { setWords(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} autoComplete="off" placeholder="Choose, or type to narrow" aria-label="Find our document in the register"
        className={cn(inputCls, "w-full pl-8")} />
      {open && found.length ? (
        <ul className="scroll-thin absolute z-30 mt-1 max-h-80 w-[28rem] overflow-y-auto rounded-md bg-surface py-1 shadow-lg ring-1 ring-line">
          {found.map((one) => (
            <li key={one.id}>
              <button type="button" onClick={() => setChosen(one)} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-tint-soft">
                <span className="block truncate text-[13px] text-slate-800">{one.title}{one.revision ? ` · rev ${one.revision}` : ""}</span>
                <span className="block truncate font-mono text-[11px] text-slate-500">{one.number}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
