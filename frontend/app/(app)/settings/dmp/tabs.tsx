import Link from "next/link";

/**
 * The plan read in the order it is made: what it says, what it is built from,
 * and the two things about it an administrator writes by hand.
 */
const TABS = [
  { href: "/settings/dmp", label: "The plan" },
  { href: "/settings/dmp?view=built", label: "What it is built from" },
  { href: "/settings/dmp?view=scope", label: "Scope & departures" },
] as const;

export function PlanTabs({ current }: { current: string }) {
  return (
    <nav className="seg w-fit max-w-full no-print" aria-label="The plan">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} scroll={false} aria-current={current === t.href ? "page" : undefined} className="segment">
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
