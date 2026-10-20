import Link from "next/link";
import { RAILS } from "@/lib/core/rails";
import { requireScope } from "@/lib/core/scope";
import {
  ArrowLeftRight, Boxes, CalendarRange, ChevronRight, CircleDot, ClipboardCheck, FileText, FolderKanban, Gauge, Hash, Import,
  ListChecks, Lock, MessageSquareText, Network, Settings, ShieldCheck, Tags, Type, Users, Workflow,
} from "lucide-react";
import { isAdmin, isController } from "@/lib/core/auth";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { ROLE_WORD, wordOf } from "@/lib/settings/role-word";
import { api, projectPath } from "@/lib/client";
import { getActiveSet } from "@/lib/settings/config";
import { projectNumbering } from "@/lib/settings/api-admin";
import { getMe } from "@/lib/account/api";
import { SETUP_PAGES, maySetup } from "@/app/(app)/settings/setup-pages";
import { cn } from "@/lib/core/utils";
import { Chip } from "@/components/ui";
import { stateNames, stateName } from "@/lib/core/state-names";
import { DOC_STATES, DOC_STATE_LABEL, DOC_STATE_COLOR, DOC_MEANING, REV_STATES, REV_STATE_COLOR, REV_MEANING } from "@/lib/core/standard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Help & orientation" };

type Place = { href?: string; title: string; text: string; icon: React.ComponentType<{ className?: string }> };

const DAILY: Place[] = [
  { href: "/documents", title: "Documents", text: "Find documents in the register, choose several, and send them for review or out on a transmittal together.", icon: FileText },
  { href: "/reviews", title: "Reviews", text: "What waits for your advice or your decision, with its comments and steps.", icon: ClipboardCheck },
  { href: "/schedule", title: "Schedule", text: "Each action on the schedule, the documents it needs, and whether they will be ready on its day.", icon: CalendarRange },
  { href: "/transmittals", title: "Transmittals", text: "What was sent and received, to whom, whether it was opened, and what was answered.", icon: ArrowLeftRight },
  { href: "/packages", title: "Packages", text: "Documents gathered for a supplier or a delivery: what is in, what is missing, what went.", icon: FolderKanban },
  { href: "/assets", title: "Assets & tags", text: "Every document describing a piece of equipment, a system or an area.", icon: Boxes },
  { href: "/directory", title: "Project directory", text: "Who takes part, in which role, their people, who acts as the control function and who confirms.", icon: Users },
];

const CONTROL: Place[] = [
  { href: "/conformance", title: "Assurance", text: "The checks run every day, how far the register can be trusted, and what to put right.", icon: ShieldCheck },
  { href: "/reports", title: "Reports", text: "Where the register stands, deliveries against plan, reviews waiting, progress week by week, who owes what, and the register on any day. Each prints.", icon: ListChecks },
  { href: "/exposures", title: "Use and copy exposure", text: "Copies that went out of a revision no longer valid, who holds them, and what is still to settle.", icon: Network },
  { href: "/import", title: "Import & export", text: "A deliverable list, a team, the matrix or a list, brought in from a template: each file is checked before anything is written.", icon: Import },
];

/** Each Settings page's icon on Help. */
const SETUP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  "/settings/flow": Workflow, "/settings/config": Tags, "/settings/numbering": Hash, "/settings/revisions": FileText,
  "/settings/workflow-templates": ClipboardCheck, "/settings/fields": Type, "/settings/functions": Lock, "/settings/users": Users,
  "/settings/parties": Network, "/settings/projects": Settings, "/settings/audit": ListChecks,
};

/**
 * The codes, one line each, in the register's column words: the two states the app fixes open their part of this page
 * (#states); every other is a list, opening its page in Types & sets (`list`) for whoever reads Settings.
 */
const CODES: (Place & { list?: string })[] = [
  { href: "#states", title: "Document state", text: "The document as a whole: planned, active, withdrawn or cancelled. Moves by itself; the control function or its registrar ends it.", icon: CircleDot },
  { href: "#states", title: "Revision state", text: "One revision, A, B, C…: being prepared, in review, released, superseded. Moves as the work moves.", icon: FileText },
  { list: "REVIEW_OUTCOMES", title: "Review verdict", text: "The verdict on a revision in review, from the organization's review outcomes, each meaning accepted, accepted with comments, rejected or for information.", icon: ClipboardCheck },
  { list: "REVIEW_ADVICE", title: "Review advice", text: "The advice a step gives before the decision; never less than its comments say.", icon: MessageSquareText },
  { list: "STATUSES", title: "Released for", text: "What a released revision may be used for (IFC, IFR…): the decider grants it, and the revision is released at it.", icon: Tags },
  { list: "CRITICALITY", title: "Criticality", text: "How much a document matters; its type recommends a level.", icon: Gauge },
  { list: "CONFIDENTIALITY", title: "Confidentiality", text: "A document above a function's clearance is read only by those named on it, its registrar, or those it was sent to.", icon: Lock },
  { list: "GENERIC_TITLE_WORDS", title: "Refused titles", text: "A title that only repeats the document's type says nothing, and is refused.", icon: Type },
];

/**
 * Help & orientation, in the reference style (owner): the colour key as eight folding boxes, the codes one line each,
 * every role an organization can play on a project as tabs (ours marked "us", those taking part here marked), how to
 * read a document number, then where each thing is done. How the project is set up is not repeated here (owner: "no more
 * redundancies"): the Settings pages are read by everyone of ours, and listed here as they open for the person.
 */
export default async function GuidePage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const ctx = await requireScope();
  const { user, project } = ctx;
  const sp = await searchParams;
  const canControl = isController(user);
  const canConfigure = isAdmin(user);
  type Directory = {
    organizations: { name: string; role: string | null; kind: string; contact: string | null }[];
  };
  const [roleOptions, directory, numbering, deliverables, register, me] = await Promise.all([
    contractRoleOptions().then((all) => all.filter((r) => r.code !== "GENERIC")),
    api<Directory>(projectPath(ctx, "/people/directory")).catch(() => null),
    projectNumbering().catch(() => null),
    getActiveSet("DELIVERABLE_TYPES").catch(() => []),
    api<{ rows: { number: string }[] }>(projectPath(ctx, "/register"), { query: { per: 100 } }).catch(() => ({ rows: [] })),
    getMe(),
  ]);
  const mine = me?.projects.find((p) => p.id === ctx.projectId) ?? null;
  const ours = roleOptions.find((r) => r.code === project.role);
  // Who plays each role on this project: the other organizations taking part, by the role the project gives them.
  const playing = new Map<string, string[]>();
  for (const o of directory?.organizations ?? []) {
    if (o.kind === "OURS" || !o.role) continue;
    playing.set(o.role, [...(playing.get(o.role) ?? []), o.name]);
  }
  const shown = roleOptions.find((r) => r.code === sp.role) ?? ours ?? roleOptions[0];

  // How to read a number: each scheme that numbers a deliverable type, its parts in order, read on one of its numbers.
  // Documents only: what numbers transmittals, packages, reviews and tags (routed as "@…") is not a document's number.
  const routed = (numbering?.routing ?? []).filter((r) => r.active && !r.deliverableType.startsWith("@"));
  const schemes = (numbering?.schemes ?? []).filter((s) => s.active && routed.some((r) => r.schemeId === s.id));
  const readings = schemes.map((s) => {
    const types = routed.filter((r) => r.schemeId === s.id)
      .map((r) => deliverables.find((d) => d.code === r.deliverableType)?.label ?? r.deliverableType);
    const example = register.rows.map((d) => d.number).find((n) => s.delimiter && n.split(s.delimiter).length === s.fields.length) ?? null;
    return { scheme: s, types, pieces: example ? example.split(s.delimiter) : null };
  }).filter((r) => r.scheme.fields.length > 0);

  // The Settings pages this person opens (the hub's own list): read only for whoever may not change them.
  const setup: Place[] = SETUP_PAGES.filter((page) => maySetup(user, page)).map((page) => ({
    href: page.href, title: page.title, icon: SETUP_ICON[page.href] ?? Settings,
    text: page.href === "/settings/functions" && mine ? `${page.text} Yours here is ${mine.function.name}.` : page.text,
  }));
  const numberingOpen = setup.some((one) => one.href === "/settings/numbering");
  // A list's code opens its values in Types & sets for whoever reads it; otherwise it is named only.
  const listsOpen = setup.some((one) => one.href === "/settings/config");
  const codes: Place[] = CODES.map(({ list, ...one }) => ({ ...one, href: list ? (listsOpen ? `/settings/config?set=${list}` : undefined) : one.href }));
  const names = await stateNames(ctx);

  const jumps = [
    { href: "#colours", label: "The colours" },
    { href: "#codes", label: "The codes" },
    { href: "#states", label: "The states" },
    { href: "#roles", label: "Roles on a project" },
    { href: "#setup", label: "Reading a number" },
    { href: "#places", label: "Where things are done" },
  ];

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 pt-6 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">Help &amp; orientation</h1>
          <p className="plate-meta mt-2">{project.code} · {ours ? `we are ${ours.label}` : "our role is not stated"}</p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            What the colours down the side of a line say, what the codes mean, the roles an organization plays on a project, how this
            project is set up, and where each thing is done.
          </p>
          <nav aria-label="On this page" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {jumps.map((one) => <a key={one.href} href={one.href} className="font-semibold text-link hover:underline">{one.label}</a>)}
          </nav>
        </div>
      </section>

      {/* The key to the side colours: eight areas, four by two, all open (owner: opening one by one is clicks for nothing). */}
      <section id="colours" className="register register-sheet register-sheet-open scroll-mt-24">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">What the colours say</span>
          <span className="text-[11px] text-slate-500">the line down the side of a row or a card: one colour per state, close states in close colours</span>
        </div>
        <div className="grid grid-cols-1 items-start gap-3 px-5 py-4 sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
          {RAILS.map((group) => (
            <div key={group.area} className="overflow-hidden rounded-md ring-1 ring-line">
              <p className="stencil px-3 py-2 text-slate-600">{group.area}</p>
              <ul className="space-y-0.5 border-t border-line px-3 py-2">
                {group.items.map((one) => (
                  <li key={one.rail + one.name} className={`rail ${one.rail} py-0.5 text-xs text-slate-700`}>{one.name}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <div id="codes" className="scroll-mt-24">
        <Places title="The codes" said={listsOpen ? "the words of the register’s columns: the states below, each list in Types & sets" : "the words of the register’s columns"} places={codes} />
      </div>

      {/* The two states the app fixes (no Settings page shows them to everyone): their pills, what each means, how it gets there. */}
      <section id="states" className="register register-sheet register-sheet-open scroll-mt-24">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">The states</span>
          <span className="text-[11px] text-slate-500">fixed by the app, the same on every project; they only move forward</span>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 px-5 py-4 sm:px-6 xl:grid-cols-2">
          <States title="Document state" said="the document as a whole"
            rows={DOC_STATES.map((s) => ({ key: s, name: DOC_STATE_LABEL[s], tone: DOC_STATE_COLOR[s], ...DOC_MEANING[s] }))} />
          <States title="Revision state" said="one revision, A, B, C…"
            rows={REV_STATES.map((s) => ({ key: s, name: stateName(names, s), tone: REV_STATE_COLOR[s], ...REV_MEANING[s] }))} />
        </div>
      </section>

      {/* Every role an organization can play on a project, as tabs: ours marked "us", those taking part here marked. */}
      <section id="roles" className="register register-sheet register-sheet-open scroll-mt-24">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Roles on a project</span>
          <span className="text-[11px] text-slate-500">what an organization can be contracted to do, on any project: what it does, where approval sits, what its verdict is worth</span>
        </div>
        <div className="border-b border-line px-5 py-3 sm:px-6">
        {/* The Schedule's tabs (owner): one frame split in equal parts, the chosen one lit with the brand line under it. */}
        <nav aria-label="Roles" className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface sm:grid-cols-5">
          {roleOptions.map((r) => {
            const us = r.code === project.role;
            const here = playing.has(r.code);
            const on = shown?.code === r.code;
            return (
              <Link key={r.code} href={`/guide?role=${r.code}#roles`} scroll={false} title={r.label} aria-current={on ? "page" : undefined}
                className={cn("flex items-center justify-center gap-1.5 border-line px-3 py-2.5 text-[13px] font-semibold transition [&:not(:last-child)]:border-r [&:nth-child(-n+5)]:sm:border-b",
                  on ? "bg-surface text-brand-ink shadow-[inset_0_-3px_0_0_var(--color-brand)]"
                    : "bg-slate-100 text-slate-600 shadow-[inset_0_-3px_0_0_var(--color-brand)]/20 hover:bg-surface hover:text-brand-ink")}>
                {r.code}
                {us ? <span className="rounded-sm bg-brand px-1 text-[10px] font-bold uppercase leading-4 text-white">us</span>
                  : here ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label={`on ${project.code}`} /> : null}
              </Link>
            );
          })}
        </nav>
        {/* The key, only for the marks shown. */}
        <p className="mt-2 text-[11px] text-slate-500">
          <span className="rounded-sm bg-brand px-1 text-[10px] font-bold uppercase text-white">us</span> our role on {project.code}
          {playing.size ? <><span className="ml-3 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" aria-hidden /> the role of another organization taking part in {project.code}</> : null}
        </p>
        </div>
        {shown ? (
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 px-5 py-4 text-xs leading-5 sm:px-6 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <dt className="font-semibold text-slate-900">{shown.label}</dt>
            <dd className="text-slate-600">{shown.description}</dd>
            <dt className="font-semibold text-slate-700">Where approval sits</dt>
            <dd className="text-slate-600">{shown.approval}</dd>
            {ROLE_WORD[shown.code] ? (
              <>
                <dt className="font-semibold text-slate-700">What it sends</dt>
                <dd className="text-slate-600">{ROLE_WORD[shown.code].sends}</dd>
                <dt className="font-semibold text-slate-700">What comes to it</dt>
                <dd className="text-slate-600">{ROLE_WORD[shown.code].receives}</dd>
              </>
            ) : null}
            <dt className="font-semibold text-slate-700">Its verdict on what is sent to it</dt>
            <dd className="text-slate-600">{wordOf(shown.code)}</dd>
            <dt className="font-semibold text-slate-700">On {project.code}</dt>
            <dd className={cn(shown.code === project.role || playing.has(shown.code) ? "text-slate-800" : "text-slate-500")}>
              {shown.code === project.role ? "Us. " : ""}
              {playing.get(shown.code)?.join(", ") ?? (shown.code === project.role ? "" : "No organization plays it here.")}
            </dd>
          </dl>
        ) : null}
        {canConfigure ? (
          <p className="border-t border-line px-5 py-2.5 text-[11px] leading-4 text-slate-500 sm:px-6">
            A role your contracts use that is not here is added to Contract roles in the organization&rsquo;s{" "}
            <Link href="/organization/settings/types" className="font-semibold text-link hover:underline">Types &amp; sets</Link>, with what it
            is and where approval sits.
          </p>
        ) : null}
      </section>

      {/* How the project is set up: what everyone should know, folding; the page itself opens for those who change it. */}
      <section id="setup" className="register register-sheet register-sheet-open scroll-mt-24">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Reading a number</span>
          <span className="text-[11px] text-slate-500">what each part of a document number says, read on one of this project&rsquo;s own</span>
        </div>
        <ul className="divide-y divide-line">
          <Fold icon={Hash} title="How to read a document number" href={numberingOpen ? "/settings/numbering" : undefined}>
            {readings.length ? readings.map(({ scheme, types, pieces }) => (
              <div key={scheme.id} className="space-y-1.5">
                <p className="text-slate-600">
                  <span className="font-semibold text-slate-800">{scheme.name}</span>
                  {types.length ? <> numbers {types.join(", ")}</> : null}. Its parts, in order, separated by &ldquo;{scheme.delimiter}&rdquo;:
                </p>
                <ol className="flex flex-wrap items-stretch gap-1">
                  {scheme.fields.map((f, i) => (
                    <li key={i} className="rounded-md bg-tint-soft px-2 py-1 ring-1 ring-line">
                      {pieces ? <span className="block font-mono text-[12.5px] font-semibold text-slate-900">{pieces[i]}</span> : null}
                      <span className="block text-[11px] text-slate-500">{f.label}{f.source === "SEQUENCE" ? ", the running number" : f.source === "FIXED" ? ", always the same" : ""}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )) : <p className="text-slate-500">No numbering is set up on {project.code} yet.</p>}
            <p className="text-slate-500">A number is given by the app when a document is registered, and never changes: nobody types it.</p>
          </Fold>
        </ul>
      </section>

      <div id="places" className="scroll-mt-24 space-y-4">
        <Places title="Do the work" said="what everyone on the project uses" places={DAILY} />
        {canControl ? <Places title="See the whole flow" said="for the control function: how the register stands, and what to put right" places={CONTROL} /> : null}
        {setup.length ? <Places title="How it is set up" said="read by everyone of ours; changed by whoever each page names" places={setup} /> : null}
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
          <li key={name} className="grid grid-cols-[1rem_minmax(0,1fr)] items-baseline gap-x-3 px-5 py-2.5 sm:grid-cols-[1rem_14rem_minmax(0,1fr)] sm:px-6">
            <Icon aria-hidden className="h-4 w-4 translate-y-0.5 text-slate-400" />
            {href ? <Link href={href} className="text-[13px] font-semibold text-link hover:underline">{name}</Link> : <span className="text-[13px] font-semibold text-slate-800">{name}</span>}
            <p className="col-start-2 text-xs leading-5 text-slate-600 sm:col-start-3">{text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One line of "How it is set up": its name, folding open on what is good to know; the page linked for whoever changes it. */
function Fold({ icon: Icon, title, href, children }: { icon: React.ComponentType<{ className?: string }>; title: string; href?: string; children: React.ReactNode }) {
  return (
    <li>
      <details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 px-5 py-2.5 hover:bg-tint-soft sm:px-6 [&::-webkit-details-marker]:hidden">
          <Icon aria-hidden className="h-4 w-4 text-slate-400" />
          <span className="text-[13px] font-semibold text-slate-900">{title}</span>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 text-slate-400 transition-transform duration-150 ease-out group-open:rotate-90" />
        </summary>
        <div className="space-y-3 px-5 pb-4 pl-12 text-xs leading-5 sm:px-6 sm:pl-[3.25rem]">
          {children}
          {href ? <p><Link href={href} className="font-semibold text-link hover:underline">Where it is changed</Link></p> : null}
        </div>
      </details>
    </li>
  );
}

/** One of the fixed states, as a short table: its pill (the register's own colours), what it means, how it gets there. */
function States({ title, said, rows }: { title: string; said: string; rows: { key: string; name: string; tone: string; means: string; how: string }[] }) {
  return (
    <div>
      <p className="text-xs"><span className="font-semibold text-slate-900">{title}</span> <span className="text-slate-500">· {said}</span></p>
      <ul className="mt-2 divide-y divide-line rounded-md ring-1 ring-line">
        {rows.map((one) => (
          <li key={one.key} className="grid grid-cols-1 gap-x-3 gap-y-1 px-3 py-2 text-xs leading-5 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <span><Chip className={one.tone}>{one.name}</Chip></span>
            <span className="text-slate-700">{one.means} <span className="text-slate-500">{one.how}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
