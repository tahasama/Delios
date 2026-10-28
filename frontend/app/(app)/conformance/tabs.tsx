import Link from "next/link";
import { BadgeCheck, Ban, BookOpen, ListChecks } from "lucide-react";

/**
 * Assurance read in the order it is lived: what the register is checked against
 * and what that found, what may still be in use although it is out of date,
 * what the application refuses outright, the page that states all of it to
 * somebody outside, and the project's document management plan. Drawn as the
 * tab strip (`.strip`), as Reports' and the Schedule's.
 */
const TABS = [
  { href: "/conformance/checks", label: "What is checked", icon: ListChecks, internal: true },
  { href: "/conformance/rules", label: "Default rules", icon: Ban, internal: true },
  { href: "/conformance/statement", label: "Conformance", icon: BadgeCheck, internal: false },
  { href: "/conformance/plan", label: "The plan", icon: BookOpen, internal: true },
] as const;

export function AssuranceTabs({ current, internal = true }: { current: string; internal?: boolean }) {
  return (
    <nav className="strip strip-full" aria-label="Assurance">
      {TABS.filter((t) => internal || !t.internal).map((t) => (
        <Link key={t.href} href={t.href} aria-current={current === t.href ? "page" : undefined} className="strip-tab">
          <t.icon />
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
