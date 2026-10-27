import Link from "next/link";

/**
 * Assurance read in the order it is lived: what the register is checked against
 * and what that found, what may still be in use although it is out of date,
 * what the application refuses outright, the page that states all of it to
 * somebody outside, and the project's document management plan.
 */
const TABS = [
  { href: "/conformance/checks", label: "What is checked", internal: true },
  { href: "/conformance/rules", label: "Default rules", internal: true },
  { href: "/conformance/statement", label: "Conformance", internal: false },
  { href: "/conformance/plan", label: "The plan", internal: true },
] as const;

export function AssuranceTabs({ current, internal = true }: { current: string; internal?: boolean }) {
  return (
    <nav className="tabs" aria-label="Assurance">
      {TABS.filter((t) => internal || !t.internal).map((t) => (
        <Link key={t.href} href={t.href} aria-current={current === t.href ? "page" : undefined} className="tab">
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
