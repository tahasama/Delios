import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarDays, FileClock, Route, SlidersHorizontal, Tags, ToggleRight, Handshake } from "lucide-react";
import { formatDay } from "@/lib/core/date-format";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { Chip } from "@/components/ui";
import { libertyOrFail } from "@/lib/organization/liberty";
import { projectDefaults } from "@/lib/organization/defaults";
import { numberingCopies, revisionCopies, routeCopies, listCopies, formCopies, functionCopies, projectDifferences } from "@/lib/settings/api-admin";
import { exceptable } from "./projects";
import { OneProject } from "./one-project";
import { SETUP_PAGES, SETUP_GROUPS } from "@/app/(app)/settings/setup-pages";
import { SETUP_ICON } from "@/app/(app)/settings/icons";
import { fmtDate } from "@/lib/core/utils";
import { ORG_CARDS } from "./cards";
import { controlFrom, effectiveAnswer, PEOPLE_KEY, PEOPLE_MODE_LABEL, PROJECT_MODE_LABEL } from "@/lib/settings/control-activities";

export const dynamic = "force-dynamic";
export const metadata = { title: "The organization's Settings" };

/**
 * The organization's Settings (owner): the same cards as a project's Settings, in the same groups and the same look,
 * opened on the organization's version, the default of every project. The masthead counts what the switches say and how
 * many projects keep their own copy; the Control room stands above the cards, as on a project; each card says where its
 * switch stands. An administrator changes the organization's here only.
 */
export default async function OrganizationSettingsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const scope = await requireOrgAdmin();
  const { project: wanted } = await searchParams;
  const [switches, defaults, numbering, revisions, routes, lists, forms, functions, projects] = await Promise.all([
    libertyOrFail(), projectDefaults({ orFail: true }), numberingCopies(), revisionCopies(), routeCopies(), listCopies(), formCopies(), functionCopies(),
    exceptable(),
  ]);
  const chosen = projects.some((p) => p.id === wanted) ? wanted! : null;
  const differences = chosen ? await projectDifferences(chosen) : null;
  const excepted = switches.reduce((n, one) => n + one.except.length, 0);
  const free = switches.filter((one) => one.free).length;
  const byCard: [string, { id: string }[]][] = [["Numbering", numbering], ["Revisions", revisions], ["Review routes", routes], ["Types & sets", lists], ["Forms & fields", forms], ["Functions & permissions", functions]];
  const copies = new Map(byCard.map(([area, rows]) => [area, rows.length]));
  // Each project once, whatever number of cards it keeps its own copy of.
  const ownProjects = new Set(byCard.flatMap(([, rows]) => rows.map((row) => row.id))).size;
  const ownCards = byCard.filter(([, rows]) => rows.length).length;
  const settings = (n: number) => `${n} ${n === 1 ? "setting" : "settings"}`;
  const said = (area?: string): { text: string; free: boolean } | null => {
    if (!area) return null;
    const items = switches.filter((one) => one.area === area);
    if (!items.length) return null;
    const n = items.filter((one) => one.free).length;
    const except = [...new Set(items.flatMap((one) => one.except.map((e) => e.projectCode)))];
    const own = (copies.get(area) ? ` · ${copies.get(area)} ${copies.get(area) === 1 ? "project has" : "projects have"} their own` : "")
      + (except.length ? ` · except on ${except.join(", ")}` : "");
    if (items.length === 1) return { text: (items[0].free ? "Free · projects may change it" : "Fixed · the same on every project") + own, free: items[0].free };
    return {
      text: (n === 0 ? `Fixed · all ${items.length} switches` : n === items.length ? `Free · all ${items.length} switches` : `${n} switches free · ${items.length - n} fixed`) + own,
      free: n > 0,
    };
  };
  const groupOf = (card: (typeof ORG_CARDS)[number]) => card.group ?? SETUP_PAGES.find((p) => p.href === card.project)?.group ?? "Organization";
  const room = switches.filter((one) => one.area === "Control room");
  const answers = new Map(Object.entries(defaults?.values ?? {}));
  const reading = controlFrom(answers, true);
  const actRow = new Map(reading.rows.map((row) => [row.activity.key, row]));
  const together = effectiveAnswer("POLICY_RELEASE", answers.get("POLICY_RELEASE")) === "TOGETHER";

  return (
    <>
      <header className="register register-sheet register-sheet-open">
        <div className="px-5 pt-5 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">Settings</h1>
          <p className="plate-meta mt-1.5 font-normal">
            How {scope.organization.name} works: the default of every project. A project&rsquo;s Settings have the same cards; what
            each may change there is said on its card here.
          </p>
        </div>
        <dl className="grid grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Fixed</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">{settings(switches.length - free)}</dd>
            <dd className="text-[11px] text-slate-500">every project uses ours as it is</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Free</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">{settings(free)}</dd>
            <dd className="text-[11px] text-slate-500">a project may take its own copy</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Their own copy</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">
              {ownProjects ? `${ownProjects} ${ownProjects === 1 ? "project" : "projects"}, on ${ownCards} ${ownCards === 1 ? "card" : "cards"}` : "None"}
            </dd>
            <dd className="text-[11px] text-slate-500">
              {ownProjects ? "listed on each card; changes here never touch them" : "every project uses ours"}
              {excepted ? ` · ${excepted} ${excepted === 1 ? "exception" : "exceptions"} to what is fixed` : ""}
            </dd>
          </div>
        </dl>
      </header>

      {/* The Control room stands above the cards, drawn as the console itself, as on a project (owner): here, what every
          new project starts with, and the way in. */}
      <section className="scene-deck" aria-labelledby="org-room-head">
        <div className="flex flex-col gap-3 px-5 pt-5 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 max-w-2xl gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[var(--deck-station)] text-[var(--deck-lit)]">
              <Route className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="org-room-head" className="text-base font-semibold text-[var(--deck-ink)]">Control room</h2>
              <p className="mt-0.5 text-xs leading-5 text-[var(--deck-mute)]">
                How a new project works, step by step: who carries each act out, releasing, planning, and what projects may change.
                Copied into each new project; a project then changes what is free.
              </p>
            </div>
          </div>
          <Link href="/organization/settings/flow" className="inline-flex h-(--control-h) shrink-0 items-center gap-2 self-start rounded-md bg-[var(--deck-lit)] px-4 text-(length:--control-text) font-semibold text-[var(--deck)] transition-colors hover:bg-white">
            Open the Control room <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <dl className="grid grid-cols-1 divide-y divide-[var(--deck-ring)] border-t border-[var(--deck-ring)] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-[var(--deck-faint)]">Who does what</dt>
            <dd className="mt-1 text-[13px] font-medium text-[var(--deck-ink)]">{PROJECT_MODE_LABEL[reading.projectMode]}</dd>
            <dd className="text-[11px] text-[var(--deck-mute)]">{defaults ? (defaults.fromProject ? `taken from ${defaults.fromProject}` : `changed ${fmtDate(defaults.at)}`) : "the app's own"}</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-[var(--deck-faint)]">Releasing</dt>
            <dd className="mt-1 text-[13px] font-medium text-[var(--deck-ink)]">{together ? "Released and issued in one act" : "Released, then issued"}</dd>
            <dd className="text-[11px] text-[var(--deck-mute)]">{together ? "releasing sends it" : "releasing means go ahead"}</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-[var(--deck-faint)]">Adding people</dt>
            <dd className="mt-1 text-[13px] font-medium text-[var(--deck-ink)]">{PEOPLE_MODE_LABEL[actRow.get(PEOPLE_KEY)?.controlDoes === false ? "SELF" : "CONTROL"]}</dd>
            <dd className="text-[11px] text-[var(--deck-mute)]">{actRow.get(PEOPLE_KEY)?.confirm ? "confirmed by whoever holds Manage" : "no confirmation"}</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-[var(--deck-faint)]">Projects may change</dt>
            <dd className="mt-1 text-[13px] font-medium text-[var(--deck-ink)]">{room.filter((one) => one.free).length} of {room.length} answers</dd>
            <dd className="text-[11px] text-[var(--deck-mute)]">the rest stay as the organization sets them</dd>
          </div>
        </dl>
      </section>

      <OneProject projects={projects} chosen={chosen} differences={differences} />

      {/* Where each card stands, in one sheet: the side menu opens them (owner: a menu rather than cards). */}
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span className="stencil mr-1 text-slate-500">Where each stands</span>
          <span className="text-[11px] text-slate-500">what each card holds, and whether projects may change it</span>
        </div>
        <ul className="divide-y divide-line">
          {SETUP_GROUPS.flatMap((group) => ORG_CARDS.filter((card) => card.slug !== "flow" && groupOf(card) === group)).map((card) => {
            const Icon = SETUP_ICON[card.project] ?? (card.slug === "identity" ? BadgeCheck : card.slug === "contract" ? Handshake : card.slug === "tracking" ? FileClock : card.slug === "calendar" ? CalendarDays : card.project === "defaults" ? SlidersHorizontal : card.project === "may-change" ? ToggleRight : Tags);
            const state = said(card.area);
            const href = card.slug ? `/organization/settings/${card.slug}` : card.elsewhere!;
            const chip = card.project === "defaults"
              ? defaults ? (defaults.fromProject ? `Taken from ${defaults.fromProject}` : `Changed ${fmtDate(defaults.at)}`) : "The app's own"
              : card.project === "may-change" ? `${switches.length - free} fixed · ${free} free`
              : card.project === "/settings/calendar" ? `${state?.text ?? ""}${state?.text ? " · " : ""}dates read ${formatDay(new Date(2026, 2, 5))}`
              : state?.text ?? "The organization's only";
            return (
              <li key={card.project}>
                <Link href={href} className="group flex items-center gap-3 px-5 py-2.5 hover:bg-tint-soft sm:px-6">
                  <Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="w-48 shrink-0 text-[13px] font-semibold text-slate-900">{card.title}</span>
                  <span className="hidden min-w-0 flex-1 truncate text-xs text-slate-500 md:block">{card.text}</span>
                  <Chip className="ml-auto shrink-0 bg-slate-100 text-slate-600 ring-slate-200">{chip}</Chip>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-link" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
