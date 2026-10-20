import Link from "next/link";
import { RAILS } from "@/lib/core/rails";
import { requireScope } from "@/lib/core/scope";
import {
  ArrowLeftRight, Boxes, CalendarRange, ClipboardCheck, FileText, FolderKanban, Import,
  ListChecks, Network, Settings, ShieldCheck, Tags, Users, Workflow,
} from "lucide-react";
import { isAdmin, isController } from "@/lib/core/auth";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { cn } from "@/lib/core/utils";

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
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 px-5 py-4 sm:grid-cols-2 sm:px-6 xl:grid-cols-3">
          {RAILS.map((group) => (
            <div key={group.area}>
              <p className="stencil mb-1.5 text-slate-500">{group.area}</p>
              <ul className="space-y-1">
                {group.items.map((one) => (
                  <li key={one.rail + one.name} className={`${one.rail} flex items-center gap-2.5 text-xs text-slate-700`}>
                    <span className="h-4 w-1 shrink-0 rounded-full bg-(--rail)" aria-hidden />
                    {one.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section id="codes" className="register register-sheet register-sheet-open scroll-mt-24">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">The codes</span>
          <span className="text-[11px] text-slate-500">Planned, Released, IFC, C1…: four kinds of status</span>
        </div>
        <p className="px-5 py-3.5 text-xs leading-5 text-slate-600 sm:px-6">
          Where a document stands, what it is issued for, what a review decided, and what a transmittal is for: who decides each, and how one
          leads to the next.{" "}
          <Link href="/guide/codes" className="font-semibold text-link hover:underline">Read the codes</Link>
        </p>
      </section>

      {/* Where approval sits under each role; this project's marked. */}
      <section id="roles" className="register register-sheet register-sheet-open scroll-mt-24">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Who approves</span>
          <span className="text-[11px] text-slate-500">what our organization is contracted to do decides where approval sits, and the matrix a project starts from</span>
        </div>
        <ul className="divide-y divide-line">
          {roleOptions.map((r) => {
            const here = r.code === project.role;
            return (
              <li key={r.code} className={cn("grid grid-cols-1 gap-x-6 gap-y-1 px-5 py-3 text-xs leading-5 sm:px-6 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]", here && "bg-tint-soft")}>
                <p className="font-semibold text-slate-900">
                  {r.label}
                  {here ? <span className="ml-2 text-[11px] font-semibold text-link">{project.code}</span> : null}
                </p>
                <div>
                  <p className="text-slate-600">{r.description}</p>
                  <p className="text-slate-500"><span className="font-semibold text-slate-700">Approval:</span> {r.approval}</p>
                </div>
              </li>
            );
          })}
        </ul>
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
