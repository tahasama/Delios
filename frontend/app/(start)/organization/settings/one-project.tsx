import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { JumpPick } from "@/components/jump-pick";
import { fmtDate } from "@/lib/core/utils";
import { KIND_LABEL, type FieldKind } from "@/lib/settings/field-policy";
import type { ProjectDifferences } from "@/lib/settings/api-admin";
import type { ProjectChoice } from "./liberty-row";
import { ORG_CARDS } from "./cards";

/** The organization's card a project's difference is put right on (its switch, its copies, its reset). */
const cardOf = (area: string) => {
  const card = ORG_CARDS.find((one) => one.area === area);
  return card?.slug ? `/organization/settings/${card.slug}` : "/organization/settings/may-change";
};

/**
 * One project, read against the organization's (owner): choose a project, and every card it changed is listed, with
 * what and since when, the fixed switches it is an exception to, and the answers it changed. Read only: the project
 * changes its own in its Settings; each line opens the organization's card, where a copy is put back or an exception ended.
 */
export function OneProject({ projects, chosen, differences }: {
  projects: ProjectChoice[]; chosen: string | null; differences: ProjectDifferences | null;
}) {
  if (!projects.length) return null;
  const nothing = differences && !differences.copies.length && !differences.answers.length && !differences.exceptions.length;
  return (
    <section className="register register-sheet register-sheet-open" aria-labelledby="one-project-head">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <h2 id="one-project-head" className="stencil text-slate-500">What a project changed</h2>
        <JumpPick label="Project" className="w-64" items={[
          { href: "/organization/settings", label: "Choose a project", on: !chosen },
          ...projects.map((p) => ({ href: `/organization/settings?project=${p.id}`, label: p.code, detail: p.name, on: p.id === chosen })),
        ]} />
        <span className="text-[11px] text-slate-500">read only: a project changes its own in its Settings</span>
      </div>
      {!differences ? null : nothing ? (
        <p className="px-5 py-3 text-[13px] text-slate-700 sm:px-6">
          {differences.project.code} changed nothing: it uses the organization&rsquo;s on every card.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {differences.copies.map((copy) => (
            <Line key={`copy-${copy.area}`} href={cardOf(copy.area)} title={copy.area}>
              Its own copy{copy.items.length ? ` of ${copy.items.map((one) => KIND_LABEL[one as FieldKind] ?? one).join(", ")}` : ""}
              {copy.since ? <> · since {fmtDate(copy.since)}{copy.by ? ` by ${copy.by}` : ""}</> : null}
            </Line>
          ))}
          {differences.answers.map((answer) => (
            <Line key={`answer-${answer.key}`} href={answer.area === "The stamp" ? "/organization/settings/stamp" : "/organization/settings/flow"} title={answer.title}>
              {answer.changed} {answer.changed === 1 ? "answer" : "answers"} changed here, against the organization&rsquo;s
              {answer.free ? null : <> · now fixed: it stays as it was changed</>}
            </Line>
          ))}
          {differences.exceptions.map((one) => (
            <Line key={`except-${one.key}`} href={cardOf(one.area)} title={one.title}>
              Fixed for every other project, free here by an exception: {one.reason} · {one.by}, {fmtDate(one.at)}
            </Line>
          ))}
        </ul>
      )}
    </section>
  );
}

function Line({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="group flex items-center gap-4 px-5 py-2.5 hover:bg-tint-soft focus-visible:bg-tint-soft focus-visible:outline-none sm:px-6">
        <span className="w-48 shrink-0 text-[13px] font-semibold text-slate-900">{title}</span>
        <span className="min-w-0 flex-1 text-xs leading-5 text-slate-600">{children}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-500 group-hover:text-link" aria-hidden />
      </Link>
    </li>
  );
}
