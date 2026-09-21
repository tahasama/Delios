import Link from "next/link";

const TABS = [
  { href: "/conformance", label: "Overview" },
  { href: "/exposures", label: "Out-of-date risks" },
  { href: "/conformance/defects", label: "Problems" },
  { href: "/conformance/checks", label: "Checks" },
  { href: "/conformance/traceability", label: "Traceability" },
  { href: "/conformance/statement", label: "Statement" },
] as const;

/**
 * Assurance is one place: is the register trustworthy, what is out of date,
 * what must be fixed, how it was checked, and the statement that reports it.
 */
export function AssuranceTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav className="scroll-thin -mx-1 flex gap-1 overflow-x-auto px-1" aria-label="Assurance">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={current === t.href ? "page" : undefined}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${current === t.href ? "bg-[#1e3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
