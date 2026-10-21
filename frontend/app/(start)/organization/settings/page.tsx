import Link from "next/link";
import { ArrowRight, BadgeCheck, FileClock, Route, Tags } from "lucide-react";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { Chip } from "@/components/ui";
import { liberty } from "@/lib/organization/liberty";
import { projectDefaults } from "@/lib/organization/defaults";
import { numberingCopies, revisionCopies, routeCopies, listCopies, formCopies } from "@/lib/settings/api-admin";
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
export default async function OrganizationSettingsPage() {
  const scope = await requireOrgAdmin();
  const [switches, defaults, numbering, revisions, routes, lists, forms] = await Promise.all([
    liberty(), projectDefaults(), numberingCopies(), revisionCopies(), routeCopies(), listCopies(), formCopies(),
  ]);
  const free = switches.filter((one) => one.free).length;
  const copies = new Map([["Numbering", numbering.length], ["Revisions", revisions.length], ["Review routes", routes.length], ["Types & sets", lists.length], ["Forms & fields", forms.length]]);
  const ownCopies = [...copies.values()].reduce((a, b) => a + b, 0);
  const said = (area?: string): { text: string; free: boolean } | null => {
    if (!area) return null;
    const items = switches.filter((one) => one.area === area);
    if (!items.length) return null;
    const n = items.filter((one) => one.free).length;
    const own = copies.get(area) ? ` · ${copies.get(area)} with their own` : "";
    if (items.length === 1) return { text: (items[0].free ? "Free · projects may change it" : "Fixed · the same on every project") + own, free: items[0].free };
    return {
      text: (n === 0 ? `Fixed · all ${items.length}` : n === items.length ? `Free · all ${items.length}` : `${n} free · ${items.length - n} fixed`) + own,
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
            <dd className="mt-1 text-[13px] font-medium text-slate-900">{switches.length - free} settings</dd>
            <dd className="text-[11px] text-slate-500">every project uses ours as it is</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Free</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">{free} settings</dd>
            <dd className="text-[11px] text-slate-500">a project may take its own copy</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Their own copy</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">{ownCopies ? `${ownCopies} on projects` : "None"}</dd>
            <dd className="text-[11px] text-slate-500">{ownCopies ? "listed on each card; changes here never touch them" : "every project uses ours"}</dd>
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

      <div className="space-y-5">
        {SETUP_GROUPS.map((group) => {
          const cards = ORG_CARDS.filter((card) => card.slug !== "flow" && groupOf(card) === group);
          if (!cards.length) return null;
          return (
            <section key={group}>
              <h2 className="stencil mb-2 text-slate-600">{group}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {cards.map((card) => {
                  const Icon = SETUP_ICON[card.project] ?? (card.slug === "identity" ? BadgeCheck : card.slug === "tracking" ? FileClock : Tags);
                  const state = said(card.area);
                  const href = card.slug ? `/organization/settings/${card.slug}` : card.elsewhere!;
                  return (
                    <Link key={card.project} href={href} className="register register-sheet group flex gap-3 px-4 py-3.5 transition hover:border-brand-line/50">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-tint text-brand-ink">
                        <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold leading-5 text-slate-900">{card.title}</span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-500 transition group-hover:text-link" aria-hidden="true" />
                        </span>
                        <span className="mt-0.5 block text-xs leading-[1.45] text-slate-600">{card.text}</span>
                        <Chip className="mt-2 bg-slate-100 text-slate-600 ring-slate-200">
                          {state?.text ?? "The organization's only"}
                        </Chip>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
