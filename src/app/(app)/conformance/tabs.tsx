import Link from "next/link";

const TABS = [
  { href: "/conformance", label: "What to fix" },
  { href: "/exposures", label: "Out-of-date risks" },
  { href: "/conformance/audit", label: "For auditors" },
] as const;

/** The auditor's tools sit behind one tab; each of their pages shows it as current. */
const AUDIT_PAGES = ["/conformance/audit", "/conformance/defects", "/conformance/checks", "/conformance/traceability", "/conformance/statement"];

/**
 * Assurance for everyday use is two questions — what must I fix, and what
 * out-of-date information may still be in use. The Standard's own instruments
 * (checks, traceability, the formal statement) are for audits and live apart.
 */
export function AssuranceTabs({ current }: { current: string }) {
  const active = AUDIT_PAGES.includes(current) ? "/conformance/audit" : current;
  return (
    <nav className="scroll-thin -mx-1 flex gap-1 overflow-x-auto px-1" aria-label="Assurance">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={active === t.href ? "page" : undefined}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${active === t.href ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
          {t.label}
        </Link>
      ))}
      {AUDIT_PAGES.includes(current) && current !== "/conformance/audit" ? (
        <Link href="/conformance/audit" className="whitespace-nowrap px-2 py-2 text-xs text-slate-400 hover:text-slate-600">← all auditor tools</Link>
      ) : null}
    </nav>
  );
}
