import { Check, CircleAlert, CircleX, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Preflight, GateLine } from "@/lib/rules/registry";
import { Clause } from "./ui";

/**
 * The step check. Requirement 3: a person should always know whether what they
 * are about to do is allowed, and if not, what to do about it.
 *
 * Three states only — passed, worth noting, blocked — because a fourth would
 * make people guess. Every blocked line names its clause and its remedy, so a
 * refusal is actionable rather than merely correct.
 */

const ICON = {
  OK: Check,
  WARN: CircleAlert,
  BLOCK: CircleX,
} as const;

const TONE = {
  OK: "text-emerald-600",
  WARN: "text-amber-600",
  BLOCK: "text-red-600",
} as const;

function Line({ line }: { line: GateLine }) {
  const Icon = ICON[line.verdict];
  return (
    <li className="flex items-start gap-2">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", TONE[line.verdict])} aria-hidden />
      <span className="min-w-0">
        <span className={cn("text-xs", line.verdict === "OK" ? "text-slate-500" : "font-medium text-slate-800")}>
          {line.message}
        </span>
        {line.remedy ? <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">{line.remedy}</span> : null}
        <span className="mt-0.5 block text-[10px] text-slate-400">
          {line.title} · <Clause>{line.clause}</Clause>
        </span>
      </span>
    </li>
  );
}

export function PreflightPanel({
  result,
  className,
  showPassed = false,
}: {
  result: Preflight;
  className?: string;
  /** Passed lines are hidden by default — the interesting ones are the rest. */
  showPassed?: boolean;
}) {
  const problems = [...result.blocked, ...result.warnings];
  const tone = result.blocked.length
    ? "border-red-200 bg-red-50/60"
    : result.warnings.length
      ? "border-amber-200 bg-amber-50/50"
      : "border-emerald-200 bg-emerald-50/50";

  return (
    <div className={cn("rounded-xl border p-3", tone, className)}>
      <p
        className={cn(
          "flex items-center gap-1.5 text-xs font-semibold",
          result.blocked.length ? "text-red-800" : result.warnings.length ? "text-amber-900" : "text-emerald-800",
        )}
      >
        {result.blocked.length ? <CircleX className="h-4 w-4" /> : result.warnings.length ? <CircleAlert className="h-4 w-4" /> : <Check className="h-4 w-4" />}
        {result.summary}
      </p>

      {problems.length ? (
        <ul className="mt-2 space-y-2">
          {problems.map((line) => <Line key={line.id} line={line} />)}
        </ul>
      ) : null}

      {showPassed && result.passed.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-600">
            {result.passed.length} check{result.passed.length === 1 ? "" : "s"} passed
          </summary>
          <ul className="mt-1.5 space-y-2">
            {result.passed.map((line) => <Line key={line.id} line={line} />)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** One line, for placing beside a button without a full panel. */
export function PreflightBadge({ result }: { result: Preflight }) {
  const Icon = result.blocked.length ? CircleX : result.warnings.length ? CircleAlert : Check;
  const tone = result.blocked.length ? "text-red-700" : result.warnings.length ? "text-amber-800" : "text-emerald-700";
  return (
    <span className={cn("inline-flex items-start gap-1.5 text-[11px] leading-snug", tone)}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      {result.summary}
    </span>
  );
}

/**
 * A control that states why it cannot be used, rather than being mysteriously
 * greyed out. When blocked it renders as text, not a dead button.
 */
export function Guarded({
  result,
  children,
  hint,
}: {
  result: Preflight;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  if (!result.ok) {
    return (
      <div className="space-y-2">
        <PreflightPanel result={result} />
        {hint}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {result.warnings.length ? <PreflightPanel result={result} /> : null}
      {children}
      {result.warnings.length === 0 ? (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <Info className="h-3 w-3" /> {result.passed.length} check{result.passed.length === 1 ? "" : "s"} passed.
        </p>
      ) : null}
    </div>
  );
}
