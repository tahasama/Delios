import Link from "next/link";
import { ArrowRight, BadgeCheck, Ban, BookOpen, ListChecks } from "lucide-react";

/**
 * Assurance read in the order it is lived: what the register is checked against
 * and what that found, what may still be in use although it is out of date,
 * what the application refuses outright, the page that states all of it to
 * somebody outside, and the project's document management plan. Drawn as the
 * Schedule's tabs (`.views`), the owner's design for every set of real tabs.
 */
const TABS = [
  { href: "/conformance/checks", label: "What is checked", hint: "and what was found", icon: ListChecks, internal: true },
  { href: "/conformance/rules", label: "Default rules", hint: "what the app refuses", icon: Ban, internal: true },
  { href: "/conformance/statement", label: "Conformance", hint: "the statement", icon: BadgeCheck, internal: false },
  { href: "/conformance/plan", label: "The plan", hint: "how it is done here", icon: BookOpen, internal: true },
] as const;

export function AssuranceTabs({ current, internal = true }: { current: string; internal?: boolean }) {
  return (
    <nav className="views" aria-label="Assurance">
      {TABS.filter((t) => internal || !t.internal).map((t) => (
        <Link key={t.href} href={t.href} aria-current={current === t.href ? "page" : undefined} className="view">
          <t.icon />
          {t.label}
          <span className="view-hint hidden lg:inline">· {t.hint}</span>
          <ArrowRight className="view-go" />
        </Link>
      ))}
    </nav>
  );
}
