import Link from "next/link";
import { TONE } from "@/lib/core/tones";
import { cn } from "@/lib/core/utils";
import { AlertTriangle, CheckCircle2, Info as InfoIcon, Lightbulb } from "lucide-react";

// Shared, server-safe UI primitives. Buttons are plain <button>/<Link> so forms
// work without client JavaScript.
//
// These are drawn in the register's vocabulary — the one described in
// docs/DETAIL-STYLE.md — rather than in a vocabulary of their own. The registers
// and the two detail pages were built directly out of .register-sheet, .stencil
// and .plate-*; everything else in the application reaches those same parts
// through the primitives here. So a card is a sheet, a masthead is a plate, and
// a rule is the one hairline token, which is what makes the whole application
// read as one thing instead of two.
//
// Every signature below is unchanged on purpose: a page keeps saying exactly
// what it said before, and nothing a page was showing is dropped to fit the
// new shape.

/**
 * A whole page's masthead. It sits on a sheet of its own, so a page opens the
 * way a register opens rather than with text floating on the canvas.
 *
 * This is `.plate-title`, the masthead of a whole register — not `.plate-name`,
 * which names one record and is set in the serif. Keeping the two apart is the
 * point: a page about everything and a page about one thing should not look
 * alike.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  eyebrow?: string;
  /** A figure the page is about, inside the title card rather than under it. */
  children?: React.ReactNode;
}) {
  return (
    <header className="register register-sheet register-sheet-open mb-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-5 pb-4 sm:px-6">
        <div className="min-w-0">
          {eyebrow ? <p className="stencil mb-1.5 text-slate-400">{eyebrow}</p> : null}
          <h1 className="plate-title text-slate-950">{title}</h1>
          {subtitle ? <p className="plate-meta mt-1.5 max-w-3xl font-normal">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="border-t border-line px-5 py-4 sm:px-6">{children}</div> : null}
    </header>
  );
}

/**
 * A sheet. What used to be a card: the same three things go in — what it is,
 * the sentence about it, and anything that acts on the whole of it — but they
 * are set in the band the register uses, so a panel here and a panel on the
 * action page are the same object.
 */
export function Card({
  title,
  description,
  children,
  className,
  actions,
  id,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={cn("register register-sheet", className)}>
      {title ? (
        <header className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <h2 className="stencil mr-1 shrink-0 text-slate-500">{title}</h2>
          {description ? <p className="min-w-0 text-[11px] leading-4 text-slate-500">{description}</p> : null}
          {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="px-5 py-4 sm:px-6">{children}</div>
    </section>
  );
}

/**
 * A state, a verdict, a count — something found rather than read. Square rather
 * than a pill, because the register stamps and chips are square and a rounded
 * pill is the one shape that says "web app" out loud.
 */
/** The reference status chip (Schedule & actions): one word, one of four tones. */
export { TONE };

/**
 * A tip: advice that helps, never a rule or a warning, so it does not look like either: a dashed frame on the page's
 * own surface (light and dark), a yellow bulb, "TIP", the lead in bold, then the advice. An order that works is given as
 * numbered `steps`, each a link to where it is done when it has one.
 */
export function Tip({
  lead,
  children,
  steps,
  className,
}: {
  lead?: React.ReactNode;
  children?: React.ReactNode;
  steps?: { label: React.ReactNode; hint?: React.ReactNode; href?: string; current?: boolean }[];
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border border-dashed border-line-strong bg-surface px-3 py-2.5 text-xs leading-5 text-slate-700", className)}>
      <p className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700" aria-hidden="true">
          <Lightbulb className="h-3 w-3" />
        </span>
        <span className="min-w-0">
          <span className="mr-1.5 text-[11px] font-semibold tracking-wide text-amber-700 uppercase">Tip</span>
          {lead ? <span className="font-semibold text-slate-800">{lead} </span> : null}
          {children}
        </span>
      </p>
      {steps?.length ? (
        <ol className="mt-2 space-y-1 pl-[1.875rem]">
          {steps.map((step, index) => {
            const body = (
              <>
                <span
                  className={cn(
                    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ring-1",
                    step.current ? "bg-brand text-white ring-brand" : "bg-tint-soft text-slate-700 ring-line",
                  )}
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className={cn("block font-semibold", step.href ? "text-link group-hover:underline" : "text-slate-800")}>{step.label}</span>
                  {step.hint ? <span className="block text-[11px] text-slate-500">{step.hint}</span> : null}
                </span>
              </>
            );
            return (
              <li key={index}>
                {step.href ? (
                  <Link href={step.href} aria-current={step.current ? "step" : undefined} className="group flex items-start gap-2 rounded-md -mx-1 px-1 py-0.5 hover:bg-tint-soft">{body}</Link>
                ) : (
                  <span className="flex items-start gap-2 px-0 py-0.5">{body}</span>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

/**
 * A state in one of the app's tones, drawn as every state pill is (`Chip`). Inside a register's lines it keeps the round
 * shape those lines always had (owner: registers are not restyled), `inRegister`.
 */
export function ToneChip({ tone, children, title, inRegister }: { tone: keyof typeof TONE; children: React.ReactNode; title?: string; inRegister?: boolean }) {
  if (inRegister) return <span title={title} className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1", TONE[tone])}>{children}</span>;
  return <Chip title={title} className={TONE[tone]}>{children}</Chip>;
}

export function Chip({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center whitespace-nowrap rounded-[0.3rem] px-1.5 py-0.5 text-[11px] font-semibold leading-[1.35] ring-1 ring-inset", className ?? "bg-canvas-deep text-slate-700 ring-line")}>
      {children}
    </span>
  );
}

export function StateChip({ label, color }: { label: string; color: string }) {
  return <Chip className={color}>{label}</Chip>;
}

export function SeverityChip({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    CRITICAL: "bg-red-50 text-red-800 ring-red-200",
    MAJOR: "bg-orange-50 text-orange-800 ring-orange-200",
    MINOR: "bg-amber-50 text-amber-900 ring-amber-200",
    ADVISORY: "bg-sky-50 text-sky-800 ring-sky-200",
  };
  return <Chip className={map[severity] ?? ""}>{severity}</Chip>;
}

export function btn(variant: "primary" | "secondary" | "danger" | "ghost" = "primary", size: "sm" | "md" = "md") {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-(--control-radius) font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-link/20 disabled:cursor-not-allowed disabled:opacity-50";
  // The app's one control size (--control-h): every button stands the same
  // height as every field and every .ask. "sm" keeps a narrower side padding only.
  const sizes = size === "sm" ? "h-(--control-h) px-3 text-(length:--control-text)" : "h-(--control-h) px-3.5 text-(length:--control-text)";
  const variants = {
    primary: "bg-brand text-white hover:bg-brand-hover",
    secondary: "border border-line-strong bg-surface text-slate-700 hover:border-brand-line hover:bg-tint",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "text-slate-600 hover:bg-tint-soft hover:text-slate-900",
  };
  return `${base} ${sizes} ${variants[variant]}`;
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <Link href={href} className={cn(btn(variant, size), className)}>
      {children}
    </Link>
  );
}

export function Field({
  label,
  hint,
  children,
  required,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    // The register's question: a stencil label with its hint beside it, and an
    // underlined field — the same everywhere a form asks something.
    <label className={cn("block min-w-0", className)}>
      {/* One line, whatever the hint: fields side by side keep their labels level, never a mosaic. The whole hint
          shows on hover. */}
      <span className="mb-1.5 flex h-4 min-w-0 items-baseline gap-2 leading-4 overflow-hidden">
        <span className="stencil shrink-0 text-slate-500">
          {label}
          {required ? <span className="ml-0.5 text-red-500">*</span> : null}
        </span>
        {hint ? <span className="min-w-0 truncate text-[11px] leading-4 text-slate-400" title={hint}>{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full min-h-(--control-h) rounded-t-[0.25rem] rounded-b-none border-0 border-b border-line-strong bg-[color-mix(in_oklab,var(--color-canvas)_60%,var(--color-surface))] px-1.5 py-1 text-(length:--control-text) text-slate-800 outline-none transition-colors placeholder:text-slate-400 hover:border-slate-400 hover:bg-[color-mix(in_oklab,var(--color-canvas)_85%,var(--color-surface))] focus:border-brand-line disabled:cursor-not-allowed disabled:border-dashed disabled:bg-transparent disabled:text-slate-500 disabled:hover:bg-transparent";

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-canvas/50 px-8 py-12 text-center">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {body ? <p className="mt-1.5 max-w-md text-[11.5px] leading-4 text-slate-400">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** A column header. Carries the resize handle that DataTable listens for. */
/**
 * A word that needs one sentence of explanation, without spending a paragraph on
 * it: the sentence is on hover and on focus, so the screen stays short and
 * nobody has to guess what "retention" or "AB" means.
 */
export function Info({ children, className }: { children: string; className?: string }) {
  return (
    <span tabIndex={0} role="note" data-note title={children} aria-label={children} className={cn("ml-1 inline-flex cursor-help align-[-2px] text-slate-400 transition-colors hover:text-brand-ink", className)}>
      <InfoIcon className="h-3.5 w-3.5" strokeWidth={2} />
    </span>
  );
}

export function Th({ children, className, label, title, sorted }: {
  children?: React.ReactNode;
  className?: string;
  label?: string;
  title?: string;
  /** Which way this column is sorted, when it is the one sorted. */
  sorted?: "asc" | "desc" | null;
}) {
  return (
    <th
      scope="col"
      data-label={label}
      title={title}
      // The arrow says it to whoever can see it; aria-sort says the same thing
      // to whoever cannot, and tells them which column the order belongs to.
      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : label ? "none" : undefined}
      className={cn("dt-th", className)}
    >
      {children}
      <span data-col-resizer aria-hidden className="dt-resizer" />
    </th>
  );
}

export function Td({ children, className, colSpan, title }: { children?: React.ReactNode; className?: string; colSpan?: number; title?: string }) {
  return (
    <td colSpan={colSpan} title={title} className={cn("dt-td", className)}>
      {children}
    </td>
  );
}

export { DataTable } from "./data-table";

export function Banner({ tone = "info", title, children }: { tone?: "info" | "warn" | "danger" | "good"; title?: string; children?: React.ReactNode }) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    danger: "border-red-300 bg-red-50 text-red-900",
    good: "border-emerald-300 bg-emerald-50 text-emerald-900",
  };
  const Icon = tone === "good" ? CheckCircle2 : tone === "info" ? InfoIcon : AlertTriangle;
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 text-[13px]", tones[tone])} role={tone === "danger" ? "alert" : "status"}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn("leading-5", title ? "mt-1" : "")}>{children}</div> : null}
      </div>
    </div>
  );
}
