import { controlDoes, controlSettings, policies, PROJECT_MODE_LABEL, PEOPLE_MODE_LABEL } from "@/lib/settings/control-activities";
import { holdersOf } from "@/lib/core/permissions";
import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { Chip, Tip } from "@/components/ui";
import { NoAccess } from "./no-access";
import { api } from "@/lib/client";
import { getActiveSet } from "@/lib/settings/config";
import { SETUP_PAGES, SETUP_GROUPS, maySetup, mayChangeControlRoom, CONTROL_ROOM, type SetupPage } from "./setup-pages";
import { families } from "@/lib/settings/families";
import {
  FolderKanban, Building2, Tags, FileDigit, BadgeCheck, Users, Workflow, ScrollText, Layers, Route, ClipboardList, ArrowRight, KeyRound,
  GitBranch, Gavel,
  type LucideIcon,
} from "lucide-react";

import { adminAudit, adminFunctions, adminNumbering, adminParties, adminProjects, adminRoutes, adminUsers, orEmpty } from "@/lib/settings/api-admin";
import { orgSettings, projectSettings } from "@/lib/settings/api";
import { getSets } from "@/lib/settings/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const ICON: Record<string, LucideIcon> = {
  "/settings/projects": FolderKanban,
  "/settings/parties": Building2,
  "/settings/config": Tags,
  "/settings/families": Layers,
  "/settings/fields": ClipboardList,
  "/settings/numbering": FileDigit,
  "/settings/flow": Route,
  "/settings/workflow-templates": Workflow,
  "/settings/functions": BadgeCheck,
  "/settings/users": Users,
  "/settings/security": KeyRound,
  "/settings/revisions": GitBranch,
  "/settings/verdicts": Gavel,
  "/settings/audit": ScrollText,
};


export default async function AdminPage() {
  const ctx = await requireScope();
  const { user } = ctx;
  // Administrators see every page; someone granted a single verb sees the page it opens.
  const managementAddsPeople = !(await controlDoes(ctx, "PROJECT_PEOPLE"));
  const open = SETUP_PAGES.filter((p) => maySetup(user, p, managementAddsPeople));
  // The menu shows Settings only to whoever may open one of its pages; reached by its address, it says so plainly.
  if (!open.length) return <NoAccess title="Settings" who="admin" />;
  const mayOpen = (href: string) => open.some((p) => p.href === href);

  // One live figure per card, so the hub says what is there, and what still needs doing, not just where to go.
  const ESSENTIAL = ["DELIVERABLE_TYPES", "DOCUMENT_TYPES", "DISCIPLINES", "STATUSES", "REASONS_FOR_ISSUE"];
  const [projects, parties, sets, numbering, functions, people, routes, events, fieldsSet, verdictLists, security, deliverables, emptyLists] = await Promise.all([
    orEmpty(adminProjects).then((all) => all.filter((p) => p.status === "ACTIVE").length),
    orEmpty(adminParties).then((all) => all.filter((p) => p.active)),
    getSets().then((all) => all.length),
    adminNumbering().catch(() => null),
    orEmpty(adminFunctions).then((all) => all.filter((f) => f.active).length),
    orEmpty(adminUsers).then((all) => all.filter((u) => u.memberships.some((m) => m.projectId === ctx.projectId && m.active)).length),
    orEmpty(adminRoutes).then((all) => all.filter((r) => r.active).length),
    adminAudit({ from: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10), per: 10 }).then((page) => page.total).catch(() => 0),
    orgSettings().then((all) => [...all.keys()].filter((k) => k.startsWith("FIELD_RULE:") || k.startsWith("FIELD_LABEL:")).length).catch(() => 0),
    api<{ verdicts: { status: string; meaning: string | null }[] }[]>("/api/admin/verdict-lists").catch(() => null),
    api<{ mfaRequired: boolean; mfaEnrolled: { enrolled: number; of: number } }>("/api/admin/security").catch(() => null),
    getActiveSet("DELIVERABLE_TYPES").catch(() => []),
    Promise.all(ESSENTIAL.map(async (key) => ((await getActiveSet(key).catch(() => [])).length ? null : key))).then((all) => all.filter(Boolean).length),
  ]);
  const [familyList, how, chosen, controllers] = await Promise.all([
    families(ctx),
    controlSettings(ctx),
    policies(ctx),
    holdersOf(ctx, "CONTROL").catch(() => []),
  ]);
  const together = chosen.find((one) => one.policy.key === "POLICY_RELEASE")?.value !== "SEPARATE";
  const adding = how.rows.find((row) => row.activity.key === "PROJECT_PEOPLE");
  const changesIt = mayChangeControlRoom(user);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const outside = parties.filter((p) => !p.isInternal).length;
  const schemes = numbering?.schemes.filter((s) => s.active).length ?? 0;
  const numbered = new Set(numbering?.routing.filter((r) => r.active).map((r) => r.deliverableType) ?? []);
  const notNumbered = deliverables.filter((d) => !numbered.has(d.code)).length;
  const revisionSchemes = numbering?.revisionSchemes.length ?? 0;
  const lists = verdictLists ?? [];
  const noMeaning = lists.flatMap((l) => l.verdicts).filter((v) => v.status === "ACTIVE" && !v.meaning).length;
  const figure: Record<string, { text: string; attention?: boolean }> = {
    "/settings/projects": { text: ctx.project.code },
    "/settings/parties": { text: `yours + ${plural(outside, "other")}` },
    "/settings/config": emptyLists ? { text: `${plural(emptyLists, "essential list")} still empty`, attention: true } : { text: plural(sets, "list") },
    "/settings/families": { text: plural(familyList.length, "family", "families") },
    "/settings/flow": { text: `who does what on ${ctx.project.code}` },
    "/settings/fields": { text: fieldsSet ? `${plural(fieldsSet, "field")} changed` : "nothing changed yet" },
    "/settings/numbering": notNumbered
      ? { text: `${plural(notNumbered, "deliverable type")} with no numbering yet`, attention: true }
      : { text: plural(schemes, "scheme") },
    "/settings/revisions": revisionSchemes ? { text: plural(revisionSchemes, "scheme") } : { text: "none yet", attention: true },
    "/settings/functions": { text: plural(functions, "function") },
    "/settings/users": people > 1 ? { text: `${plural(people, "person", "people")} on ${ctx.project.code}` } : { text: `only you on ${ctx.project.code}`, attention: true },
    "/settings/workflow-templates": routes ? { text: plural(routes, "route") } : { text: "none yet", attention: true },
    "/settings/verdicts": !lists.length ? { text: "none yet", attention: true }
      : noMeaning ? { text: `${plural(noMeaning, "verdict")} without a meaning`, attention: true } : { text: plural(lists.length, "list") },
    "/settings/security": security
      ? { text: `${security.mfaRequired ? "second step asked of everyone" : "second step optional"} · ${security.mfaEnrolled.enrolled} of ${security.mfaEnrolled.of} have it` }
      : { text: "" },
    "/settings/audit": { text: `${plural(events, "change")} this week` },
  };

  // Setting up a project, in the order that works: each step says whether it is done, and opens where it is done.
  // A step whose page this person may not open is named, with who does it.
  const steps = [
    { href: "/settings/parties", label: "The organizations you work with", done: outside > 0, said: outside ? `${outside} set up` : "only yours so far" },
    { href: "/settings/users", label: "The people on the project", done: people > 1, said: people > 1 ? `${people} on ${ctx.project.code}` : "only you so far" },
    { href: "/settings/config", label: "The lists (disciplines, types…)", done: emptyLists === 0, said: emptyLists ? `${emptyLists} essential still empty` : "filled" },
    { href: "/settings/numbering", label: "How numbers are built", done: schemes > 0 && notNumbered === 0, said: notNumbered ? `${notNumbered} deliverable type${notNumbered === 1 ? "" : "s"} not numbered` : schemes ? "every type numbered" : "no scheme yet" },
    { href: "/settings/revisions", label: "How revisions are named", done: revisionSchemes > 0, said: revisionSchemes ? "set" : "not set yet" },
    { href: "/settings/verdicts", label: "What a review decides with", done: lists.length > 0 && noMeaning === 0, said: !lists.length ? "no verdict list yet" : noMeaning ? `${noMeaning} verdict${noMeaning === 1 ? "" : "s"} without a meaning` : "ready" },
    { href: "/settings/workflow-templates", label: "The review routes", done: routes > 0, said: routes ? `${routes} route${routes === 1 ? "" : "s"}` : "none yet" },
  ];
  const nextStep = steps.find((step) => !step.done);
  const ready = !nextStep;

  return (
    <div className="space-y-5">
      <header className="register register-sheet register-sheet-open">
        <div className="flex flex-col gap-4 px-5 pt-5 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-2xl">
            <h1 className="plate-title text-slate-950">Settings</h1>
            <p className="plate-meta mt-1.5 font-normal">
              What {ctx.project.code} is built from: its organizations, people, lists, numbering and reviews. What you change here
              changes this project only.
            </p>
            {ready ? <p className="mt-2 text-xs font-semibold text-emerald-700">Everything a project needs is set up.</p> : null}
          </div>
          {ready ? null : (
            <Tip lead="Setting up a project?" className="lg:w-80 lg:shrink-0"
              steps={steps.map((step) => ({
                label: <>{step.done ? "✓ " : ""}{step.label}</>,
                hint: mayOpen(step.href) ? (step.done ? `Done · ${step.said}` : `To do · ${step.said}`) : `${step.done ? "Done" : "To do"} · an administrator does this`,
                href: mayOpen(step.href) ? step.href : undefined,
                current: step === nextStep,
              }))}>
              Do it in this order:
            </Tip>
          )}
        </div>
      </header>

      {/* The Control room stands above every page below: how the project works, and what makes it work that way. */}
      <section className="register register-sheet register-sheet-open" aria-labelledby="control-room-head">
        <div className="flex flex-col gap-3 px-5 pt-5 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 max-w-2xl gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-tint text-brand-ink">
              <Route className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="control-room-head" className="text-base font-semibold text-slate-950">Control room</h2>
              <p className="mt-0.5 text-xs leading-5 text-slate-600">
                How {ctx.project.code} works, and what makes it work that way: every step a document goes through, who carries each act out, and
                what the project has settled. Every page below is what it is built from.
              </p>
            </div>
          </div>
          <Link href={CONTROL_ROOM} className="ask shrink-0 self-start">
            {changesIt ? "Open the Control room" : "See how it works"} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        <dl className="grid grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Control function</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">
              {controllers.length ? controllers.map((one) => one.name).slice(0, 3).join(", ") + (controllers.length > 3 ? ` +${controllers.length - 3}` : "") : "None"}
            </dd>
            <dd className="text-[11px] text-slate-500">{controllers.length ? "stands between the work and the register" : "the people doing the work run the register"}</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Who does what</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">{PROJECT_MODE_LABEL[how.projectMode]}</dd>
            <dd className="text-[11px] text-slate-500">{how.set ? "chosen for this project" : "read from the project"}</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Releasing</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">{together ? "Released and issued in one act" : "Released, then issued"}</dd>
            <dd className="text-[11px] text-slate-500">{together ? "releasing sends it" : "releasing means go ahead"}</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Adding people</dt>
            <dd className="mt-1 text-[13px] font-medium text-slate-900">{PEOPLE_MODE_LABEL[adding?.controlDoes === false ? "SELF" : "CONTROL"]}</dd>
            <dd className="text-[11px] text-slate-500">{adding?.confirm ? "confirmed by whoever holds Manage" : "no confirmation"}</dd>
          </div>
        </dl>
        {changesIt ? null : (
          <p className="border-t border-line px-5 py-2.5 text-[11px] text-slate-500 sm:px-6">You read it; an administrator or the control function changes it.</p>
        )}
      </section>

      <div className="space-y-5">
        {SETUP_GROUPS.map((group) => {
          const pages = open.filter((p) => p.group === group && p.href !== CONTROL_ROOM);
          if (!pages.length) return null;
          return (
            <section key={group}>
              <h2 className="stencil mb-2 text-slate-600">{group}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pages.map((page) => {
                  const Icon = ICON[page.href] ?? Tags;
                  const f = figure[page.href];
                  return (
                    <Link
                      key={page.href}
                      href={page.href}
                      className="register register-sheet group flex gap-3 px-4 py-3.5 transition hover:border-brand-line/50"
                    >
                      {/* One neutral tint for every group: the state colours (green, amber) mean done and waiting elsewhere. */}
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-tint text-brand-ink">
                        <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold leading-5 text-slate-900">{page.title}</span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-500 transition group-hover:text-link" aria-hidden="true" />
                        </span>
                        <span className="mt-0.5 block text-xs leading-[1.45] text-slate-600">{page.text}</span>
                        {f?.text ? (
                          <Chip className={`mt-2 ${f.attention ? "bg-amber-100 text-amber-900 ring-amber-300" : "bg-slate-100 text-slate-700 ring-slate-300"}`}>
                            {f.attention ? "To do · " : ""}{f.text}
                          </Chip>
                        ) : null}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
