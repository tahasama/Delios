"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Columns3, Rows3, RotateCcw, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Every table in the app. The rows stay server-rendered; this wrapper only
 * adds what a person expects of a grid:
 *   - drag a column edge to widen or narrow it (double-click the edge to reset);
 *   - show or hide columns;
 *   - comfortable or compact rows;
 *   - a header that stays in view on long tables.
 * Choices are remembered per table in this browser. They are conveniences:
 * the page renders the same without them.
 */
type Prefs = { hidden: string[]; widths: Record<string, number>; dense: boolean };
const EMPTY: Prefs = { hidden: [], widths: {}, dense: false };
const MIN_WIDTH = 56;
const STICKY_AFTER = 14;

const same = (a: Prefs, b: Prefs) => JSON.stringify(a) === JSON.stringify(b);

function load(key: string, base: Prefs): Prefs {
  try {
    const raw = localStorage.getItem(`table:${key}`);
    return raw ? { ...base, ...JSON.parse(raw) } : base;
  } catch {
    return base;
  }
}
function save(key: string, p: Prefs, base: Prefs) {
  try {
    if (same(p, base)) localStorage.removeItem(`table:${key}`);
    else localStorage.setItem(`table:${key}`, JSON.stringify(p));
  } catch {}
}

const labelOf = (th: HTMLTableCellElement) => (th.dataset.label ?? th.textContent ?? "").replace(/\s+/g, " ").trim();

export function DataTable({
  head,
  children,
  className,
  id,
  toolbar = true,
  defaultHidden,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Storage key for this table's layout. Defaults to its column names. */
  id?: string;
  /** Set false for small tables where column controls would be noise. */
  toolbar?: boolean;
  /** Columns available from the column menu but hidden until someone asks for them. */
  defaultHidden?: string[];
}) {
  const scope = `dt${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const tableRef = useRef<HTMLTableElement>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [rows, setRows] = useState(0);
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...EMPTY, hidden: defaultHidden ?? [] }));
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const key = id ?? labels.join("|");
  const hiddenKey = (defaultHidden ?? []).join("|");
  const base = useMemo<Prefs>(() => ({ ...EMPTY, hidden: hiddenKey ? hiddenKey.split("|") : [] }), [hiddenKey]);

  // Read the columns and rows the server rendered — before paint, so saved
  // layouts apply without a flash. Runs after every render: a refresh can change both.
  useLayoutEffect(() => {
    const t = tableRef.current;
    if (!t) return;
    const ths = [...t.querySelectorAll<HTMLTableCellElement>("thead tr:last-child > th")];
    const next = ths.map(labelOf);
    setLabels((prev) => (prev.join("|") === next.join("|") ? prev : next));
    const body = [...t.querySelectorAll<HTMLTableRowElement>("tbody > tr")].filter((r) => !(r.cells.length === 1 && r.cells[0].colSpan > 1));
    setRows(body.length);
  });

  useLayoutEffect(() => {
    if (!labels.length) return;
    setPrefs(load(key, base));
  }, [key, labels.length, base]);

  const update = useCallback(
    (f: (p: Prefs) => Prefs, persist = true) =>
      setPrefs((p) => {
        const n = f(p);
        if (persist) save(key, n, base);
        return n;
      }),
    [key, base],
  );

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [menu]);

  // Column resizing: every <Th> carries a handle on its right edge.
  const onPointerDown = (e: React.PointerEvent) => {
    const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-col-resizer]");
    if (!handle) return;
    const th = handle.closest("th");
    if (!th) return;
    e.preventDefault();
    const label = labelOf(th) || `#${th.cellIndex}`;
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    let frame = 0;
    document.body.classList.add("dt-resizing");
    const move = (ev: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const w = Math.max(MIN_WIDTH, Math.round(startW + ev.clientX - startX));
        update((p) => ({ ...p, widths: { ...p.widths, [label]: w } }), false);
      });
    };
    const up = () => {
      cancelAnimationFrame(frame);
      document.body.classList.remove("dt-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPrefs((p) => { save(key, p, base); return p; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const th = (e.target as HTMLElement).closest("[data-col-resizer]")?.closest("th");
    if (!th) return;
    const label = labelOf(th) || `#${th.cellIndex}`;
    update((p) => { const widths = { ...p.widths }; delete widths[label]; return { ...p, widths }; });
  };

  // The layout is applied as a scoped stylesheet, so server-rendered cells need no changes.
  const css = useMemo(() => {
    if (!labels.length) return "";
    const s = `[data-dt="${scope}"]`;
    const out: string[] = [];
    labels.forEach((l, i) => {
      const n = i + 1;
      if (l && prefs.hidden.includes(l)) out.push(`${s} tr > :nth-child(${n}):not([colspan]){display:none}`);
      const w = prefs.widths[l || `#${i}`];
      if (w) out.push(`${s} thead th:nth-child(${n}){width:${w}px;min-width:${w}px;max-width:${w}px}${s} tbody td:nth-child(${n}):not([colspan]){max-width:${w}px;white-space:normal;overflow-wrap:anywhere;overflow:hidden;text-overflow:ellipsis}`);
    });
    return out.join("\n");
  }, [labels, prefs, scope]);

  const hideable = labels.filter(Boolean);
  const shown = hideable.filter((l) => !prefs.hidden.includes(l)).length;
  const customised = !same(prefs, base);
  const withBar = toolbar && hideable.length >= 3;
  const sticky = rows > STICKY_AFTER;

  return (
    <div className={cn("dt rounded-2xl border border-slate-200 bg-surface shadow-sm", className)} data-dt={scope} data-density={prefs.dense ? "compact" : undefined}>
      {css ? <style>{css}</style> : null}
      {withBar ? (
        <div className="no-print flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
          <p className="px-1 text-[11px] font-medium tabular-nums text-slate-400">{rows} {rows === 1 ? "row" : "rows"}</p>
          <div className="flex items-center gap-0.5">
            {customised ? (
              <button type="button" onClick={() => update(() => base)} className="dt-tool" title="Back to the standard columns, widths and row size">
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </button>
            ) : null}
            <button type="button" onClick={() => update((p) => ({ ...p, dense: !p.dense }))} className="dt-tool" aria-pressed={prefs.dense} title={prefs.dense ? "Switch to comfortable rows" : "Switch to compact rows"}>
              <Rows3 className="h-3.5 w-3.5" /> {prefs.dense ? "Compact" : "Comfortable"}
            </button>
            <div className="relative" ref={menuRef}>
              <button type="button" onClick={() => setMenu((m) => !m)} className="dt-tool" aria-expanded={menu} aria-haspopup="true">
                <Columns3 className="h-3.5 w-3.5" /> Columns{shown < hideable.length ? ` ${shown}/${hideable.length}` : ""}
              </button>
              {menu ? (
                <div className="absolute right-0 top-full z-30 mt-1 w-60 rounded-xl border border-slate-200 bg-surface p-1.5 shadow-xl" role="menu">
                  <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Show columns</p>
                  <div className="scroll-thin max-h-72 overflow-y-auto">
                    {hideable.map((l) => {
                      const on = !prefs.hidden.includes(l);
                      const last = on && shown === 1;
                      return (
                        <button
                          key={l}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={on}
                          disabled={last}
                          title={last ? "At least one column stays visible" : undefined}
                          onClick={() => update((p) => ({ ...p, hidden: on ? [...p.hidden, l] : p.hidden.filter((h) => h !== l) }))}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on ? "border-brand bg-brand text-white" : "border-slate-300 bg-surface")}>
                            {on ? <Check className="h-3 w-3" /> : null}
                          </span>
                          <span className="truncate">{l}</span>
                        </button>
                      );
                    })}
                  </div>
                  {prefs.hidden.length ? (
                    <button type="button" onClick={() => update((p) => ({ ...p, hidden: [] }))} className="mt-1 w-full rounded-lg border-t border-slate-100 px-2.5 py-1.5 text-left text-xs font-semibold text-link hover:bg-slate-50">
                      Show all
                    </button>
                  ) : null}
                  <p className="border-t border-slate-100 px-2.5 pb-1 pt-2 text-[10px] leading-4 text-slate-400">Drag a column edge to resize it; double-click the edge to reset.</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className={cn("scroll-thin overflow-x-auto", withBar ? "rounded-b-2xl" : "rounded-2xl", sticky && "dt-sticky max-h-[72vh] overflow-y-auto")} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick}>
        <table ref={tableRef} className="min-w-full">
          <thead>{head}</thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}
