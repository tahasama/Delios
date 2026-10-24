"use client";

import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/core/utils";

type Option = { value: string; label: string; disabled: boolean; group: string | null };

/** The text of an option's children: strings and numbers, however nested. */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** Every option a select's children hold: through fragments, lists, groups, and plain function components (`FilterOptions`). */
function optionsOf(children: React.ReactNode, group: string | null = null, into: Option[] = []): Option[] {
  Children.forEach(children, (child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return;
    const props = child.props;
    if (child.type === "option") {
      const label = textOf(props.children as React.ReactNode) || String(props.label ?? props.value ?? "");
      into.push({ value: String(props.value ?? label), label, disabled: !!props.disabled, group });
    } else if (child.type === "optgroup") {
      optionsOf(props.children as React.ReactNode, String(props.label ?? ""), into);
    } else if (child.type === Fragment) {
      optionsOf(props.children as React.ReactNode, group, into);
    } else if (typeof child.type === "function") {
      // A small component that only lists options (no hooks): read what it draws.
      try { optionsOf((child.type as (p: unknown) => React.ReactNode)(props), group, into); } catch { /* not a plain list */ }
    }
  });
  return into;
}

/** The room under a box before the window's edge or the first box around it that cuts what overflows it, whichever comes first. */
function roomBelow(el: HTMLElement | null): number {
  if (!el) return Infinity;
  const bottom = el.getBoundingClientRect().bottom;
  let limit = window.innerHeight;
  for (let at = el.parentElement; at; at = at.parentElement) {
    const style = getComputedStyle(at);
    if (/(hidden|auto|scroll|clip)/.test(style.overflowY + style.overflow)) { limit = Math.min(limit, at.getBoundingClientRect().bottom); break; }
  }
  return limit - bottom;
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { children?: React.ReactNode };

/**
 * Every dropdown of the app, drawn as the app draws a list of choices (owner: "all drawers, lists of choices adopt this
 * styling", the numbering's `Choice`): each option its name, the chosen one ticked and bold, the one under the arrow keys
 * lightly shaded, groups under their names, and a field to narrow a long list. It is a drop-in for `<select>`: the native
 * select stays in the form, hidden, holding the value, so the name, `form`, `required`, `defaultValue`, a controlled
 * `value` and `onChange` all work as before; choosing here sets it and tells it, as the browser would.
 */
export function Select({ children, className, style, disabled, title, id, ...rest }: SelectProps) {
  const options = optionsOf(children);
  const native = useRef<HTMLSelectElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const narrowRef = useRef<HTMLInputElement>(null);
  const list = useId();
  const [value, setValue] = useState<string>(String(rest.value ?? rest.defaultValue ?? options[0]?.value ?? ""));
  const [open, setOpen] = useState(false);
  // Opens upward when there is not room under it (the window's edge, or a card that cuts what overflows it).
  const [up, setUp] = useState(false);
  const [active, setActive] = useState(0);
  const [words, setWords] = useState("");
  const chosen = options.find((one) => one.value === value);
  const long = options.length > 12;
  const shown = words.trim()
    ? options.filter((one) => one.label.toLowerCase().includes(words.trim().toLowerCase()) || one.value.toLowerCase().includes(words.trim().toLowerCase()))
    : options;

  // What the native select holds is what is shown: after a choice, a controlled value, a form put back or reset.
  const sync = () => { if (native.current) setValue(native.current.value); };
  useLayoutEffect(sync);
  useEffect(() => {
    const select = native.current;
    if (!select) return;
    const form = select.form;
    const later = () => setTimeout(sync, 0);
    select.addEventListener("change", sync);
    select.addEventListener("delios:sync", sync);
    form?.addEventListener("reset", later);
    return () => { select.removeEventListener("change", sync); select.removeEventListener("delios:sync", sync); form?.removeEventListener("reset", later); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    if (long) narrowRef.current?.focus();
    return () => document.removeEventListener("mousedown", away);
  }, [open, long]);

  function show() {
    if (disabled) return;
    setWords("");
    setActive(Math.max(0, options.findIndex((one) => one.value === value && !one.disabled)));
    setUp(roomBelow(box.current) < Math.min(320, options.length * 32 + (long ? 44 : 12)));
    setOpen(true);
  }
  /** Chooses as the browser would: the select takes the value and says so (a filter applies at once with the pointer). */
  function pick(one: Option | undefined, how: "pointer" | "keys") {
    setOpen(false);
    const select = native.current;
    if (!one || one.disabled || !select) return;
    select.dispatchEvent(how === "pointer" ? new PointerEvent("pointerdown", { bubbles: true }) : new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    if (select.value !== one.value) {
      select.value = one.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      select.dispatchEvent(new Event("input", { bubbles: true }));
      // A controlled select goes back to its value until its owner takes the new one: show what it holds.
      setValue(one.value);
    }
  }
  function key(event: React.KeyboardEvent) {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); show(); }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
    else if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (event.key === "Enter" || (event.key === " " && !long)) { event.preventDefault(); pick(shown[active], "keys"); }
    else if (event.key === "Tab") setOpen(false);
  }

  const plain = (className ?? "").split(/\s+/).includes("plain");
  let lastGroup: string | null = null;
  return (
    <div ref={box} className="relative min-w-0" style={style}>
      <select ref={native} {...rest} id={undefined} disabled={disabled} tabIndex={-1} aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0">
        {children}
      </select>
      <button
        type="button"
        id={id}
        title={title ?? chosen?.label}
        disabled={disabled}
        data-on={(rest as Record<string, unknown>)["data-on"] as string | undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={list}
        aria-label={rest["aria-label"]}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={key}
        onBlur={(event) => {
          // Leaving the box is when a choice made with the keys applies (as on the register's filters).
          if (!box.current?.contains(event.relatedTarget as Node)) native.current?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        }}
        className={cn(className, "flex items-center justify-between gap-2 text-left", plain ? "" : "pr-0.5")}
      >
        <span className={cn("min-w-0 truncate", chosen && chosen.value !== "" ? "" : "text-slate-500")}>{chosen?.label ?? "Choose…"}</span>
        {plain ? null : <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform duration-150", open && "rotate-180")} aria-hidden="true" />}
      </button>
      {open ? (
        <div className={cn("absolute left-0 z-40 min-w-full max-w-[28rem] rounded-md bg-surface py-1 shadow-lg ring-1 ring-line", up ? "bottom-full mb-1" : "mt-1")}>
          {long ? (
            <div className="relative border-b border-line px-2 pb-1">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-3.5 w-3.5 -translate-y-[60%] text-slate-400" aria-hidden />
              <input ref={narrowRef} value={words} onChange={(e) => { setWords(e.target.value); setActive(0); }} onKeyDown={key}
                placeholder="Type to narrow" aria-label="Type to narrow" autoComplete="off"
                className="h-7 w-full bg-transparent pl-7 text-[13px] text-slate-800 outline-none placeholder:text-slate-400" />
            </div>
          ) : null}
          <ul id={list} role="listbox" className="scroll-thin max-h-80 overflow-y-auto">
            {shown.length === 0 ? <li className="px-3 py-2 text-xs text-slate-400">Nothing matches that.</li> : null}
            {shown.map((one, index) => {
              const on = one.value === value;
              const head = one.group !== lastGroup && one.group ? one.group : null;
              lastGroup = one.group;
              return (
                <Fragment key={`${one.group ?? ""}|${one.value}|${index}`}>
                  {head ? <li role="presentation" className="stencil px-3 pt-2 pb-1 text-slate-400">{head}</li> : null}
                  <li role="option" aria-selected={on} aria-disabled={one.disabled || undefined}
                    onMouseDown={(event) => { event.preventDefault(); pick(one, "pointer"); }}
                    onMouseEnter={() => setActive(index)}
                    className={cn("flex items-start gap-2 px-3 py-1.5", one.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer", index === active ? "bg-tint-soft" : "")}>
                    <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-link", on ? "" : "invisible")} aria-hidden="true" />
                    <span className={cn("block min-w-0 text-[13px] text-slate-800", on && "font-semibold", one.value === "" && !on && "text-slate-500")}>{one.label}</span>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
