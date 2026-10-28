"use client";

import { useEffect, useState } from "react";
import { LifeBuoy, X } from "lucide-react";
import { btn } from "@/components/ui";

/** The gold "Need support" button and the drawer it opens from the right (owner); Escape or a click beside it closes it. */
export function SupportPanel({ children, startOpen = false }: { children: React.ReactNode; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${btn("primary")} bg-gold! text-gold-ink! hover:bg-gold-bright!`}>
        <LifeBuoy className="h-4 w-4" /> Need support
      </button>
      {open ? (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Need support">
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 cursor-default bg-slate-900/40" />
          <aside className="register absolute inset-y-0 right-0 flex w-[min(36rem,100vw)] flex-col overflow-y-auto bg-surface shadow-2xl">
            <button type="button" title="Close" onClick={() => setOpen(false)} className={`${btn("ghost", "sm")} absolute top-5 right-4`}>
              <X aria-label="Close" className="h-4 w-4" />
            </button>
            {children}
          </aside>
        </div>
      ) : null}
    </>
  );
}
