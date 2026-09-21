"use client";

import { useEffect, useState } from "react";

export type DocTab = { id: string; label: string; count?: number; content: React.ReactNode };

/**
 * Tabs that switch in place. The server renders every panel once; switching
 * only changes which one is visible, so there is no reload, no lost scroll
 * position, and a half-filled form survives a look at another tab. The hash
 * keeps links such as `#revisions` working and makes a tab bookmarkable.
 */
export function DocTabs({ tabs }: { tabs: DocTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (tabs.some((t) => t.id === id)) setActive(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs]);

  const select = (id: string) => {
    setActive(id);
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <nav role="tablist" aria-label="Document" className="scroll-thin flex gap-1 overflow-x-auto border-b border-slate-200 px-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active === t.id}
            onClick={() => select(t.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-xs font-semibold transition ${active === t.id ? "border-[#315f83] text-[#17324d]" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {t.label}
            {t.count ? <span className="ml-1.5 rounded bg-slate-100 px-1.5 text-[10px] text-slate-600">{t.count}</span> : null}
          </button>
        ))}
      </nav>
      {tabs.map((t) => (
        <div key={t.id} id={t.id} role="tabpanel" hidden={active !== t.id} className="scroll-mt-28">
          {t.content}
        </div>
      ))}
    </section>
  );
}
