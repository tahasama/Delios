import Link from "next/link";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Info as InfoIcon } from "lucide-react";

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
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  eyebrow?: string;
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
        <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
          <h2 className="stencil shrink-0 text-slate-500">{title}</h2>
          {description ? <p className="min-w-0 text-[11px] leading-4 text-slate-400">{description}</p> : null}
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
    CRITICAL: "bg-red-100 text-red-800 ring-red-300",
    MAJOR: "bg-orange-100 text-orange-800 ring-orange-300",
    MINOR: "bg-amber-100 text-amber-800 ring-amber-300",
    ADVISORY: "bg-sky-100 text-sky-800 ring-sky-300",
  };
  return <Chip className={map[severity] ?? ""}>{severity}</Chip>;
}

export function btn(variant: "primary" | "secondary" | "danger" | "ghost" = "primary", size: "sm" | "md" = "md") {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-link/20 disabled:cursor-not-allowed disabled:opacity-50";
  const sizes = size === "sm" ? "min-h-9 px-3 py-2 text-xs" : "min-h-10 px-4 py-2.5 text-sm";
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

/**
 * A block of a form: what this part is about on the left, the fields on the
 * right. Long forms read as a few short sections instead of one column of
 * boxes.
 */
export function FormSection({ title, help, children, className }: { title: string; help?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid grid-cols-1 gap-x-8 gap-y-4 border-t border-line py-6 first:border-t-0 first:pt-0 md:grid-cols-[220px_minmax(0,1fr)]", className)}>
      <div>
        <h3 className="stencil text-slate-500">{title}</h3>
        {help ? <p className="mt-1.5 text-[11px] leading-4 text-slate-400">{help}</p> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** The bar that closes a form: what happens next on the left, the buttons on the right. */
export function FormActions({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-5 mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <p className="min-w-0 text-[11px] leading-4 text-slate-400">{note}</p>
      <div className="flex items-center gap-2">{children}</div>
    </div>
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
    <label className={cn("block", className)}>
      <span className="mb-1.5 block">
        <span className="block text-[12.5px] font-semibold text-slate-800">
          {label}
          {required ? <span className="ml-0.5 text-red-500">*</span> : null}
        </span>
        {hint ? <span className="mt-0.5 block text-[11px] leading-4 text-slate-400">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export const inputCls =
  "min-h-10 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-line focus:ring-3 focus:ring-link/15 disabled:cursor-not-allowed disabled:bg-canvas disabled:text-slate-500";

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

/**
 * One figure and what it counts. The register already has a way of setting a
 * number that is read at a glance — `.plate-figure` over `.plate-label`, mono
 * and tabular so a column of them lines up — so this uses it rather than
 * inventing a second one. The figure comes first and its name sits under it,
 * which is the order the plate uses.
 */
export function Stat({ label, value, hint, href, tone = "default" }: { label: string; value: React.ReactNode; hint?: string; href?: string; tone?: "default" | "warn" | "danger" | "good" }) {
  const tones = {
    default: "text-slate-900",
    good: "text-emerald-700",
    warn: "text-amber-700",
    danger: "text-red-700",
  };
  const body = (
    <div className="register register-sheet h-full px-5 py-4 transition-colors group-hover:border-brand-line group-hover:bg-tint-soft">
      <span className={cn("plate-figure", tones[tone])}>{value}</span>
      <span className="plate-label transition-colors group-hover:text-brand-ink">{label}</span>
      {hint ? <p className="mt-1.5 text-[11px] leading-4 text-slate-400">{hint}</p> : null}
    </div>
  );
  // Only a figure you can follow lights up, so the hover says "this is a way in"
  // rather than decorating every tile on the page.
  return href ? <Link href={href} className="group block">{body}</Link> : body;
}

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

export function Clause({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 rounded-[0.25rem] bg-canvas-deep px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{children}</span>;
}

export function KeyValue({ items }: { items: { label: string; value: React.ReactNode; clause?: string }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((it) => (
        <div key={it.label}>
          <dt className="stencil text-slate-400">{it.label}</dt>
          <dd className="mt-1 text-[13px] text-slate-800">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
