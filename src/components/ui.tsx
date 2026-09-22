import Link from "next/link";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

// Shared, server-safe UI primitives. Buttons are plain <button>/<Link> so forms
// work without client JavaScript.

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
    <header className="mb-6 flex flex-wrap items-start justify-between gap-5">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#607f99]">{eyebrow}</p> : null}
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-slate-950">{title}</h1>
        {subtitle ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 pt-0.5">{actions}</div> : null}
    </header>
  );
}

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
    <section id={id} className={cn("overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-sm", className)}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-6 py-4.5">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
            {description ? <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

export function Chip({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ring-1 ring-inset", className ?? "bg-slate-100 text-slate-700 ring-slate-300")}>
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
  const base = "inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-link/20 disabled:cursor-not-allowed disabled:opacity-50";
  const sizes = size === "sm" ? "min-h-9 px-3 py-2 text-xs" : "min-h-10 px-4 py-2.5 text-sm";
  const variants = {
    primary: "bg-brand text-white hover:bg-brand-hover",
    secondary: "border border-slate-300 bg-surface text-slate-700 hover:bg-slate-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "text-slate-600 hover:bg-slate-100",
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
    <label className={cn("block", className)}>
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700">
          {label}
          {required ? <span className="ml-0.5 text-red-500">*</span> : null}
        </span>
        {hint ? <span className="max-w-[60%] text-right text-[11px] leading-4 text-slate-400">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export const inputCls =
  "min-h-10 w-full rounded-xl border border-slate-300 bg-surface px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-brand-line focus:ring-3 focus:ring-link/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-8 py-14 text-center">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {body ? <p className="mt-1.5 max-w-md text-xs leading-5 text-slate-500">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** A column header. Carries the resize handle that DataTable listens for. */
export function Th({ children, className, label }: { children?: React.ReactNode; className?: string; label?: string }) {
  return (
    <th scope="col" data-label={label} className={cn("dt-th", className)}>
      {children}
      <span data-col-resizer aria-hidden className="dt-resizer" />
    </th>
  );
}

export function Td({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("dt-td", className)}>
      {children}
    </td>
  );
}

export { DataTable } from "./data-table";

export function Stat({ label, value, hint, href, tone = "default" }: { label: string; value: React.ReactNode; hint?: string; href?: string; tone?: "default" | "warn" | "danger" | "good" }) {
  const tones = {
    default: "text-slate-900",
    good: "text-emerald-700",
    warn: "text-amber-700",
    danger: "text-red-700",
  };
  const body = (
    <div className="rounded-2xl border border-slate-200 bg-surface px-5 py-4 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums", tones[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-xs leading-5 text-slate-400">{hint}</p> : null}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function Banner({ tone = "info", title, children }: { tone?: "info" | "warn" | "danger" | "good"; title?: string; children?: React.ReactNode }) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    danger: "border-red-300 bg-red-50 text-red-900",
    good: "border-emerald-300 bg-emerald-50 text-emerald-900",
  };
  const Icon = tone === "good" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-sm", tones[tone])} role={tone === "danger" ? "alert" : "status"}>
      <Icon className="mt-0.5 h-4.5 w-4.5 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn("leading-5", title ? "mt-1" : "")}>{children}</div> : null}
      </div>
    </div>
  );
}

export function Clause({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{children}</span>;
}

export function KeyValue({ items }: { items: { label: string; value: React.ReactNode; clause?: string }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((it) => (
        <div key={it.label}>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {it.label}
          </dt>
          <dd className="mt-0.5 text-sm text-slate-800">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
