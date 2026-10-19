"use client";

import { useEffect, useState } from "react";
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
  useEffect(() => {
    if (chosen || words.trim().length < 2) { setFound([]); return; }
    let live = true;
    const wait = setTimeout(() => { findOursAction(words).then((rows) => { if (live) setFound(rows); }); }, 250);
    return () => { live = false; clearTimeout(wait); };
  }, [words, chosen]);

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
    <span className="relative block w-72">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
      <input value={words} onChange={(e) => setWords(e.target.value)} placeholder="Find it in the register" aria-label="Find our document in the register"
        className={cn(inputCls, "w-full pl-8")} />
      {found.length ? (
        <ul className="absolute z-20 mt-1 max-h-64 w-[28rem] overflow-auto rounded-md bg-white py-1 shadow-lg ring-1 ring-line dark:bg-slate-900">
          {found.map((one) => (
            <li key={one.id}>
              <button type="button" onClick={() => setChosen(one)} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-tint-soft">
                <span className="font-mono font-semibold text-slate-900">{one.number}</span>
                <span className="ml-2 text-slate-500">{one.title}{one.revision ? ` · rev ${one.revision}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
