import Link from "next/link";
import { RAILS } from "@/lib/core/rails";
import { requireScope } from "@/lib/core/scope";
import {
  ArrowLeftRight, Boxes, ChevronRight, CalendarRange, ClipboardCheck, FileText, FolderKanban, Import,
  ListChecks, Network, Settings, ShieldCheck, Tags, Users, Workflow,
} from "lucide-react";
import { isAdmin, isController } from "@/lib/core/auth";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { cn } from "@/lib/core/utils";
import { getActiveSet } from "@/lib/settings/config";
import { stateNames, stateName } from "@/lib/core/state-names";
import { DOC_STATE_LABEL } from "@/lib/core/standard";
import { ROLE_WORD, WORD_GROUPS } from "@/lib/settings/role-word";

export const dynamic = "force-dynamic";
export const metadata = { title: "Help & orientation" };

type Place = { href: string; title: string; text: string; icon: React.ComponentType<{ className?: string }> };

const DAILY: Place[] = [
  { href: "/documents", title: "Documents", text: "Find documents in the register, choose several, and send them for review or out on a transmittal together.", icon: FileText },
  { href: "/reviews", title: "Reviews", text: "What waits for your advice or your decision, with its comments and steps.", icon: ClipboardCheck },
  { href: "/schedule", title: "Schedule", text: "Each action on the schedule, the documents it needs, and whether they will be ready on its day.", icon: CalendarRange },
  { href: "/transmittals", title: "Transmittals", text: "What was sent and received, to whom, whether it was opened, and what was answered.", icon: ArrowLeftRight },
  { href: "/packages", title: "Packages", text: "Documents gathered for a supplier or a delivery: what is in, what is missing, what went.", icon: FolderKanban },
  { href: "/assets", title: "Assets & tags", text: "Every document describing a piece of equipment, a system or an area.", icon: Boxes },
];

const CONTROL: Place[] = [
  { href: "/conformance", title: "Assurance", text: "The checks run every day, how far the register can be trusted, and what to put right.", icon: ShieldCheck },
  { href: "/reports", title: "Reports", text: "Where the register stands, deliveries against plan, reviews waiting, progress week by week, who owes what, and the register on any day. Each prints.", icon: ListChecks },
  { href: "/exposures", title: "Use and copy exposure", text: "Copies that went out of a revision no longer valid, who holds them, and what is still to settle.", icon: Network },
  { href: "/import", title: "Import & export", text: "A deliverable list, a team, the matrix or a list, brought in from a template: each file is checked before anything is written.", icon: Import },
];

const SETUP: Place[] = [
  { href: "/settings", title: "Settings", text: "How this project works, in the order it is set up: organizations, people, lists, numbering, revisions, outcomes, routes.", icon: Settings },
  { href: "/organization/settings/types", title: "Types & sets", text: "The organization's lists, the default of every project, and which ones a project may change.", icon: Tags },
  { href: "/organization/settings/numbering", title: "Numbering", text: "How documents, transmittals, packages and tags are numbered, the same on every project.", icon: FileText },
  { href: "/settings/workflow-templates", title: "Review routes", text: "Each route, its steps, who answers each, and the outcomes it decides with.", icon: Workflow },
  { href: "/settings/parties", title: "Organizations", text: "Who takes part in the project, their role with us, and the function their people get.", icon: Network },
  { href: "/settings/users", title: "People & access", text: "Who is on the project, in which function and department, and how someone joins.", icon: Users },
];

/**
 * Help & orientation, in the reference style (owner, after the critique): what the side colours say, what the codes
 * mean, where approval sits under each role, then where each thing is done, one line each. No banner, no figures (Home
 * has them), no grid of cards repeating the menu; a group of places shows only to those who may use it.
 */
export default async function GuidePage() {
  const ctx = await requireScope();
  const { user, project } = ctx;
  const canControl = isController(user);
  const canConfigure = isAdmin(user);
  const roleOptions = (await contractRoleOptions()).filter((r) => r.code !== "GENERIC");
  const ours = roleOptions.find((r) => r.code === project.role);
  const [outcomes, statuses, names] = await Promise.all([getActiveSet("REVIEW_OUTCOMES").catch(() => []), getActiveSet("STATUSES").catch(() => []), stateNames()]);
  // The four things called "status", each with this organization's own values where it publishes them.
  const kinds = [
    { title: "Where the document stands", about: "The document number as a whole.", values: (["PLANNED", "ACTIVE", "WITHDRAWN", "CANCELLED"] as const).map((one) => DOC_STATE_LABEL[one]),
      who: "moves by itself; the control function ends it" },
    { title: "Where a revision stands", about: "One revision, A, B, C…", values: ["IN_PREPARATION", "IN_REVIEW", "RELEASED", "SUPERSEDED"].map((one) => stateName(names, one)),
      who: "moves as the work moves" },
    { title: "What the review decided", about: "The decision on a revision in review, one of four meanings.", values: outcomes.map((o) => o.code),
      who: "whoever decides on the route" },
    { title: "What it is issued for", about: "What a released revision may be used for.", values: statuses.map((o) => o.code),
      who: "the decider grants it; it is released at it" },
  ];

  const jumps = [
    { href: "#colours", label: "The colours" },
    { href: "#codes", label: "The codes" },
    { href: "#roles", label: "Who approves" },
    { href: "#places", label: "Where things are done" },
  ];

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 pt-6 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">Help &amp; orientation</h1>
          <p className="plate-meta mt-2">{project.code} · {ours ? `we are ${ours.label}` : "our role is not stated"}</p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            What the colours down the side of a line say, what the codes mean, who approves under each role, and where each thing is done.
          </p>
          <nav aria-label="On this page" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {jumps.map((one) => <a key={one.href} href={one.href} className="font-semibold text-link hover:underline">{one.label}</a>)}
          </nav>
        </div>
      </section>

      {/* The key to the side colours: one meaning each, on every list, card and plan (globals.css .rail-*). */}
      <section id="colours" className="register register-sheet register-sheet-open scroll-mt-24">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">What the colours say</span>
          <span className="text-[11px] text-slate-500">the line down the side of a row or a card: one colour per state, close states in close colours</span>
        </div>
        {/* Each area as the lists draw it: rows, the real rail down the side (register .rail), widening on hover. */}
        <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2 sm:px-6 xl:grid-cols-3">
          {RAILS.map((group) => (
            <div key={group.area} className="overflow-hidden rounded-md ring-1 ring-line">
              <p className="stencil border-b border-line bg-tint-soft px-3 py-1.5 text-slate-500">{group.area}</p>
              <ul className="divide-y divide-line">
                {group.items.map((one) => (
                  <li key={one.rail + one.name} className={`key-row rail ${one.rail} py-1.5 pr-3 text-xs text-slate-700`}>{one.name}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section id="codes" className="register register-sheet register-sheet-open scroll-mt-24">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">The codes</span>
          <span className="text-[11px] text-slate-500">four different things are called “status”: each answers its own question</span>
        </div>
        <dl className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
          {kinds.map((one) => (
            <div key={one.title} className="space-y-1.5 px-5 py-3.5 sm:px-6">
              <dt className="text-[13px] font-semibold text-slate-900">{one.title}</dt>
              <dd className="text-xs leading-5 text-slate-600">{one.about}</dd>
              <dd className="flex flex-wrap gap-1">
                {one.values.length ? one.values.map((v) => <span key={v} className="code-chip">{v}</span>) : <span className="text-[11px] text-slate-400">none published yet</span>}
              </dd>
              <dd className="text-[11px] leading-4 text-slate-500"><span className="font-semibold text-slate-600">Who:</span> {one.who}</dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-line px-5 py-2.5 text-[11px] text-slate-500 sm:px-6">
          Each in full, with what it means and how one leads to the next:{" "}
          <Link href="/guide/codes" className="font-semibold text-link hover:underline">States and codes</Link>
        </p>
      </section>

      {/* Where approval sits under each role; this project's marked. */}
      <section id="roles" className="register register-sheet register-sheet-open scroll-mt-24">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Who approves</span>
          <span className="text-[11px] text-slate-500">what we are contracted to do decides what our verdict is worth</span>
        </div>
        {ours ? (
          <div className="border-b border-line bg-tint-soft px-5 py-4 sm:px-6">
            <p className="text-sm font-semibold text-slate-900">On {project.code} we are {ours.label}</p>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">{ours.description}</p>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-700"><span className="font-semibold">Approval:</span> {ours.approval}</p>
          </div>
        ) : null}
        {/* Every role, by what our verdict is worth under it (ROLE_WORD, as the Control room draws it); a name opens what the role does. */}
        <div className="grid grid-cols-1 divide-y divide-line lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {WORD_GROUPS.map((g) => {
            const roles = roleOptions.filter((r) => (ROLE_WORD[r.code]?.ours ?? "final") === g.key);
            return (
              <div key={g.key} className="px-5 py-3.5 sm:px-6">
                <p className="text-[13px] font-semibold text-slate-900">{g.title}</p>
                <p className="mb-2 text-[11px] text-slate-500">{g.said}</p>
                <ul className="space-y-1.5">
                  {roles.map((r) => (
                    <li key={r.code}>
                      <details className="group">
                        <summary className={cn("flex cursor-pointer list-none items-baseline gap-1.5 text-xs [&::-webkit-details-marker]:hidden",
                          r.code === project.role ? "font-semibold text-link" : "text-slate-800")}>
                          <ChevronRight aria-hidden className="h-3 w-3 shrink-0 translate-y-0.5 text-slate-400 transition-transform duration-150 ease-out group-open:rotate-90" />
                          <span>{r.label}{r.code === project.role ? <span className="ml-1.5 text-[11px]">· {project.code}</span> : null}</span>
                        </summary>
                        <div className="mt-1 space-y-1 pl-4.5 text-xs leading-5">
                          <p className="text-slate-600">{r.description}</p>
                          <p className="text-slate-500"><span className="font-semibold text-slate-700">Approval:</span> {r.approval}</p>
                          {ROLE_WORD[r.code]?.decider ? <p className="text-slate-500"><span className="font-semibold text-slate-700">Decides after us:</span> {ROLE_WORD[r.code]!.decider}</p> : null}
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        {canConfigure ? (
          <p className="border-t border-line px-5 py-2.5 text-[11px] leading-4 text-slate-500 sm:px-6">
            A role your contracts use that is not here is added to Contract roles in the organization&rsquo;s{" "}
            <Link href="/organization/settings/types" className="font-semibold text-link hover:underline">Types &amp; sets</Link>. Only the roles above
            start with a matrix; one you add starts empty, and its lines are written in the{" "}
            <Link href="/distribution" className="font-semibold text-link hover:underline">distribution matrix</Link>.
          </p>
        ) : null}
      </section>

      <div id="places" className="scroll-mt-24 space-y-4">
        <Places title="Do the work" said="what everyone on the project uses" places={DAILY} />
        {canControl ? <Places title="See the whole flow" said="for the control function: how the register stands, and what to put right" places={CONTROL} /> : null}
        {canConfigure ? <Places title="Set it up" said="for administrators: how the project and the organization work" places={SETUP} /> : null}
      </div>
    </div>
  );
}

/** One group of places: a sheet, one line each (its name a link, one sentence), never a grid of cards. */
function Places({ title, said, places }: { title: string; said: string; places: Place[] }) {
  return (
    <section className="register register-sheet register-sheet-open">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil mr-1 text-slate-500">{title}</span>
        <span className="text-[11px] text-slate-500">{said}</span>
      </div>
      <ul className="divide-y divide-line">
        {places.map(({ href, title: name, text, icon: Icon }) => (
          <li key={href} className="grid grid-cols-[1rem_minmax(0,1fr)] items-baseline gap-x-3 px-5 py-2.5 sm:grid-cols-[1rem_12rem_minmax(0,1fr)] sm:px-6">
            <Icon aria-hidden className="h-4 w-4 translate-y-0.5 text-slate-400" />
            <Link href={href} className="text-[13px] font-semibold text-link hover:underline">{name}</Link>
            <p className="col-start-2 text-xs leading-5 text-slate-600 sm:col-start-3">{text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
