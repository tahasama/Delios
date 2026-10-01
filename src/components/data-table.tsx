"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Columns3, GripVertical, RotateCcw, Check } from "lucide-react";
import { createPortal } from "react-dom";
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
/** A saved layout. `dense` is read from older saved layouts and ignored. */
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

/**
 * A column's name, as the show/hide menu prints it. Hover notes inside a header
 * carry `data-note` and are left out, or every column would end in "i".
 */
const labelOf = (th: HTMLTableCellElement) => {
  if (th.dataset.label) return th.dataset.label.replace(/\s+/g, " ").trim();
  const copy = th.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[data-note]").forEach((note) => note.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
};

export function DataTable({
  head,
  children,
  className,
  id,
  toolbar = true,
  defaultHidden,
  onMove,
  onReorder,
  forced,
  tools,
  fill,
  capHeight,
  stretch,
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
  /**
   * Lets the column menu move a column. Dragging a header is a fiddly gesture
   * for something people do rarely, so a table that can be reordered says so
   * here instead, with two arrows per row.
   */
  onMove?: (label: string, by: -1 | 1) => void;
  /** Drops a column where another one sits — the menu's drag, for a long move. */
  onReorder?: (label: string, onto: string) => void;
  /**
   * Columns that stay visible whatever the saved layout says, because
   * something on the page depends on them — a filter that narrowed by one.
   */
  forced?: string[];
  /**
   * Anything else that acts on the table as a whole — taking it away as a file,
   * printing it — shown beside the column controls, which is where somebody
   * looking for what they can do to a table looks.
   */
  tools?: React.ReactNode;
  /**
   * Makes the rows the only thing that scrolls: the table stands 85% of the
   * window tall, its bar holds under the application header and its paging
   * holds the floor of the window, so the tools and the place in the table stay
   * put while the rows move between them.
   */
  fill?: boolean;
  /**
   * How tall the card holding this table should come to. What its tools bar,
   * header row and footer take is measured, and the rows are given the rest, so
   * a page that draws the same rows another way can hand both views one number
   * and have them end at the same line.
   */
  capHeight?: number;
  /**
   * The card around this table already has a height, and the table is to fill
   * what is left of it. Nothing is measured: the rows take the space, and the
   * footer stays at the bottom where it was.
   */
  stretch?: boolean;
}) {
  const scope = `dt${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const tableRef = useRef<HTMLTableElement>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [rows, setRows] = useState(0);
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...EMPTY, hidden: defaultHidden ?? [] }));
  const [menu, setMenu] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  /** The row the dragged column would land on, so the drop is shown before it happens. */
  const [over, setOver] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);
  /**
   * Where the menu hangs. A table that fills a card sits inside something that
   * clips what leaves it, so the menu is placed against the window rather than
   * against the card, and is given the room that is actually below the button.
   */
  const menuButton = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ top: number; right: number; maxHeight: number } | null>(null);

  /** Where the menu would hang from the button, in page coordinates. */
  const placeMenu = useCallback(() => {
    const box = menuButton.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      top: box.bottom + window.scrollY + 6,
      right: Math.max(document.documentElement.clientWidth - box.right, 8),
      maxHeight: Math.max(window.innerHeight - box.bottom - 24, 200),
    };
  }, []);
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

  // A panel that hangs off the page follows the page, so it is closed when the
  // ground moves under it rather than chasing it frame by frame.
  useEffect(() => {
    if (!menu) return;
    const shut = () => setMenu(false);
    const away = (event: Event) => {
      // Scrolling inside the menu is not the ground moving under it.
      if (menuPanel.current?.contains(event.target as Node)) return;
      shut();
    };
    window.addEventListener("resize", shut);
    window.addEventListener("scroll", away, true);
    return () => {
      window.removeEventListener("resize", shut);
      window.removeEventListener("scroll", away, true);
    };
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      const at = e.target as Node;
      if (!menuRef.current?.contains(at) && !menuPanel.current?.contains(at)) setMenu(false);
    };
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
      if (l && prefs.hidden.includes(l) && !(forced ?? []).includes(l)) out.push(`${s} tr > :nth-child(${n}):not([colspan]){display:none}`);
      const w = prefs.widths[l || `#${i}`];
      if (w) out.push(`${s} thead th:nth-child(${n}){width:${w}px;min-width:${w}px;max-width:${w}px}${s} tbody td:nth-child(${n}):not([colspan]){max-width:${w}px;white-space:normal;overflow-wrap:anywhere;overflow:hidden;text-overflow:ellipsis}`);
    });
    return out.join("\n");
  }, [labels, prefs, scope, forced]);

  const hideable = labels.filter(Boolean);
  const shown = hideable.filter((l) => !prefs.hidden.includes(l)).length;
  const customised = !same(prefs, base);
  const withBar = toolbar && hideable.length >= 3;
  const sticky = rows > STICKY_AFTER;

  // How tall the rows are: the window, less everything that will still be on
  // screen when the page is scrolled to the bottom — the application header,
  // the table's own bar above the rows, the paging under them, and whatever
  // padding the page keeps below the frame. All four are read from the page
  // rather than assumed, and none of them depends on the height being set, so
  // there is no loop.
  const scroller = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    // Where the card says how tall it is, the table simply fills it: the rows
    // take whatever the tools bar, the header row and the footer leave, and no
    // measurement decides anything.
    if (!fill || stretch) return;
    const box = scroller.current;
    if (!box) return;
    const bar = box.parentElement?.querySelector<HTMLElement>(":scope > .dt-bar") ?? null;
    const frame = box.closest<HTMLElement>("[data-dt-frame]");
    const foot = frame?.querySelector<HTMLElement>(":scope > [data-dt-foot]") ?? null;
    const header = document.querySelector<HTMLElement>("[data-app-header]");

    const measure = () => {
      const page = document.documentElement;
      // What the page keeps under the frame: measured as the gap between the
      // frame's foot and the end of the document, so a change of page padding
      // needs no change here.
      const edge = frame
        ? Math.max(0, Math.round(page.scrollHeight - (frame.getBoundingClientRect().bottom + window.scrollY)))
        : 0;
      const taken = (header?.offsetHeight ?? 0) + (bar?.offsetHeight ?? 0) + (foot?.offsetHeight ?? 0) + edge;
      const room = Math.round(window.innerHeight - taken);
      // A table that shares a page with another view of the same rows ends
      // where that view ends. What the tools bar and the header row take is
      // measured rather than guessed, so the two cards match whatever the
      // labels wrap to.
      const head = box.querySelector<HTMLElement>("thead")?.offsetHeight ?? 0;
      // Where a card height is given, it is the answer: the rows take all of it
      // that the bar, the header row and the footer leave. Clamping that to what
      // the window happens to have left would leave the card standing taller
      // than its rows, with a band of nothing under them.
      const capped = capHeight
        ? capHeight - (bar?.offsetHeight ?? 0) - head - (foot?.offsetHeight ?? 0)
        : room;
      setHeight(Math.max(120, capped));
    };

    measure();
    window.addEventListener("resize", measure);
    // A late webfont, a wrapped label or a header that changes shape all change
    // the sums above without the window ever being resized.
    const watch = new ResizeObserver(measure);
    for (const part of [bar, foot, header]) if (part) watch.observe(part);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => { window.removeEventListener("resize", measure); watch.disconnect(); };
  }, [fill, stretch, rows, capHeight]);

  return (
    <div className={cn("dt rounded-2xl border border-line bg-surface shadow-sm", stretch && "flex min-h-0 flex-1 flex-col", className)} data-dt={scope}>
      {css ? <style>{css}</style> : null}
      {withBar ? (
        <div className={cn(
          "dt-bar no-print flex items-center justify-between gap-2 rounded-t-[inherit] border-b border-line bg-surface px-3 py-1.5",
        )}>
          <p className="px-1 text-[11px] font-medium tabular-nums text-slate-400">{rows} {rows === 1 ? "row" : "rows"}</p>
          <div className="flex items-center gap-0.5">
            {customised ? (
              <button type="button" onClick={() => update(() => base)} className="dt-tool" title="Back to the standard columns and widths">
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </button>
            ) : null}
            {tools}

            <div className="relative" ref={menuRef}>
              <button
                ref={menuButton}
                type="button"
                onClick={() => setMenu((open) => { if (!open) setMenuAt(placeMenu()); return !open; })}
                className="dt-tool"
                aria-expanded={menu}
                aria-haspopup="true"
              >
                <Columns3 className="h-3.5 w-3.5" /> Columns{shown < hideable.length ? ` ${shown}/${hideable.length}` : ""}
              </button>
              {menu && menuAt ? createPortal(
                <div
                  ref={menuPanel}
                  className="dt-menu scroll-thin absolute z-50 w-60 overflow-y-auto overscroll-contain rounded-xl p-1.5"
                  role="menu"
                  style={{ top: menuAt.top, right: menuAt.right, maxHeight: menuAt.maxHeight }}
                >
                  <p className="flex items-center justify-between px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    Show columns
                    {onReorder ? <span className="font-medium normal-case tracking-normal text-slate-400">{dragging ? `Moving ${dragging}` : "drag to reorder"}</span> : null}
                  </p>
                  <div>
                    {hideable.map((l) => {
                      const on = !prefs.hidden.includes(l);
                      const last = on && shown === 1;
                      return (
                        <div
                          key={l}
                          draggable={!!onReorder}
                          onDragStart={(e) => { setDragging(l); e.dataTransfer.effectAllowed = "move"; }}
                          onDragEnd={() => { setDragging(null); setOver(null); }}
                          onDragOver={(e) => {
                            if (!onReorder || !dragging || dragging === l) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setOver(l);
                          }}
                          onDragLeave={() => setOver((held) => (held === l ? null : held))}
                          onDrop={() => { if (onReorder && dragging) onReorder(dragging, l); setDragging(null); setOver(null); }}
                          className={cn(
                            "dt-col group/col relative flex items-center gap-1 rounded-lg pr-1",
                            onReorder && "cursor-grab active:cursor-grabbing",
                            dragging === l ? "opacity-40" : "hover:bg-slate-50",
                            over === l && "dt-col-target",
                          )}
                        >
                          {onReorder ? <GripVertical className="dt-col-grip h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden /> : null}
                          <button
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={on}
                            disabled={last}
                            title={last ? "At least one column stays visible" : undefined}
                            onClick={() => update((p) => ({ ...p, hidden: on ? [...p.hidden, l] : p.hidden.filter((h) => h !== l) }))}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pl-1 pr-1.5 text-left text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on ? "border-brand bg-brand text-white" : "border-line-strong bg-surface")}>
                              {on ? <Check className="h-3 w-3" /> : null}
                            </span>
                            <span className="truncate">{l}</span>
                            {(forced ?? []).includes(l) ? <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wide text-slate-400" title="A filter is narrowing by this column, so it stays in view">filtered</span> : null}
                          </button>
                          {onMove ? (
                            <span className="flex shrink-0 opacity-0 transition-opacity group-hover/col:opacity-100">
                              <button type="button" aria-label={`Move ${l} left`} title="Move this column left" onClick={() => onMove(l, -1)} className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                                <ChevronUp className="h-3 w-3" />
                              </button>
                              <button type="button" aria-label={`Move ${l} right`} title="Move this column right" onClick={() => onMove(l, 1)} className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                                <ChevronDown className="h-3 w-3" />
                              </button>
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {prefs.hidden.length ? (
                    <button type="button" onClick={() => update((p) => ({ ...p, hidden: [] }))} className="mt-1 w-full rounded-lg border-t border-line px-2.5 py-1.5 text-left text-xs font-semibold text-link hover:bg-slate-50">
                      Show all
                    </button>
                  ) : null}
                  <p className="border-t border-line px-2.5 pb-1 pt-2 text-[10px] leading-4 text-slate-400">Drag a column edge to resize it; double-click the edge to reset.{onMove ? " Drag a row here to move a column, or step it with the arrows." : ""}</p>
                </div>,
                document.body,
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div
        ref={scroller}
        style={!stretch && fill && height ? { maxHeight: height } : undefined}
        className={cn(
          "scroll-thin overflow-x-auto",
          withBar ? "rounded-b-[inherit]" : "rounded-[inherit]",
          (sticky || fill) && "dt-sticky overflow-y-auto",
          sticky && !fill && "max-h-[72vh]",
          stretch && "min-h-0 flex-1",
        )}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
      >
        <table ref={tableRef} className="min-w-full">
          <thead>{head}</thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}
