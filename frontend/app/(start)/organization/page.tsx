import Link from "next/link";
import { ArrowRight, BadgeCheck, Building2, FileClock, FolderKanban, Route, ScrollText, Settings2, Users, type LucideIcon } from "lucide-react";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { adminParties, adminProjects, adminUsers } from "@/lib/settings/api-admin";
import { organizationLinks, joinedProjects, ownIdentity, claims, merges } from "@/lib/organization/api";
import { projectDefaults } from "@/lib/organization/defaults";
import { acceptLinkAction, refuseLinkAction, switchOrganizationAction } from "@/lib/organization/forms";
import { switchProjectAction } from "@/lib/settings/forms-project-switch";
import { effectiveAnswer } from "@/lib/settings/control-activities";
import { liberty } from "@/lib/organization/liberty";
import { orgSettings } from "@/lib/settings/api";
import { fmtDate } from "@/lib/core/utils";
import { Sheet } from "./sheet";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization" };

/**
 * The organization's overview (owner: one click to whatever one came for, never a long page to work through): the
 * masthead with its figures; what waits for an answer (invitations, merges and claims), answered there; then one tile
 * per part of the organization, each with its figure and its quickest ways in (the projects one is on open in one
 * click), the whole of it on its own page. Its administrators only; it needs no project.
 */
export default async function OrganizationPage() {
  const scope = await requireOrgAdmin();
  const [links, joined, projects, users, parties, defaults, answers, own, claimable, mergeList, switches] = await Promise.all([
    organizationLinks(), joinedProjects(), adminProjects().catch(() => []), adminUsers().catch(() => []), adminParties().catch(() => []),
    projectDefaults(), orgSettings().catch(() => new Map<string, string>()), ownIdentity(), claims(), merges(), liberty(),
  ]);
  const received = links.filter((one) => one.side === "GUEST" && one.state === "INVITED");
  const ours = users.filter((one) => one.internal);
  const activePeople = ours.filter((one) => one.active).length;
  const outside = parties.filter((one) => !one.isInternal);
  const me = users.find((one) => one.id === scope.user.id);
  const mineOurs = projects.filter((p) => p.status === "ACTIVE" && me?.memberships.some((m) => m.active && m.projectId === p.id));
  const mineJoined = joined.filter((p) => p.ourPeople.some((one) => one.userId === scope.user.id && one.active));
  const freeCount = switches.filter((one) => one.free).length;
  const changedCount = Object.entries(defaults?.values ?? {}).filter(([key, value]) => value !== effectiveAnswer(key, null)).length;
  const mergesWaiting = mergeList.filter((m) => m.waitsOnUs).length;
  const claimsWaiting = claimable.incoming.length;
  const reading = answers.get("TRACK_READING") !== "OFF";
  const signIns = answers.get("TRACK_SIGN_INS") === "ON";
  const linked = outside.filter((p) => p.link?.state === "LINKED").length;

  return (
    <>
      <header className="register register-sheet register-sheet-open">
        <div className="flex flex-col gap-3 px-5 pt-5 pb-4 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            {own ? <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">{own.code}</p> : null}
            <h1 className="plate-name mt-1 min-w-0">{scope.organization.name}</h1>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              The organization: its projects and those of others it works on, its people, the organizations it works with, and how every project starts.
            </p>
          </div>
          <Link href="/organization/projects?new=1" className="ask shrink-0 self-start">Open a new project</Link>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4 [&>div]:bg-surface">
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Our projects</dt>
            <dd className="mt-1 text-[13px] font-medium tabular-nums text-slate-900">{projects.filter((p) => p.status === "ACTIVE").length} open</dd>
            <dd className="text-[11px] text-slate-500">{projects.filter((p) => p.status !== "ACTIVE").length} archived</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">Others&rsquo; projects</dt>
            <dd className="mt-1 text-[13px] font-medium tabular-nums text-slate-900">{joined.length}</dd>
            <dd className="text-[11px] text-slate-500">we take part in</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">People</dt>
            <dd className="mt-1 text-[13px] font-medium tabular-nums text-slate-900">{activePeople}</dd>
            <dd className="text-[11px] text-slate-500">{ours.length - activePeople ? `${ours.length - activePeople} switched off` : "all can sign in"}</dd>
          </div>
          <div className="px-5 py-3 sm:px-6">
            <dt className="stencil text-slate-500">We work with</dt>
            <dd className="mt-1 text-[13px] font-medium tabular-nums text-slate-900">{outside.filter((p) => p.active).length} organizations</dd>
            <dd className="text-[11px] text-slate-500">{received.length ? `${received.length} invitation${received.length === 1 ? "" : "s"} to answer` : "no invitation waiting"}</dd>
          </div>
        </dl>
      </header>

      {received.length ? (
        <Sheet title={`Invitations waiting for your answer (${received.length})`} note="another organization asks us to work on its projects" tone="waiting">
          <ul className="divide-y divide-line [&>li]:px-5 sm:[&>li]:px-6">
              {received.map((one) => (
                <li key={one.id} className="space-y-2 py-3">
                  <p className="text-sm text-slate-700">
                    <strong>{one.organization}</strong> invites us to work on its projects, with our own accounts. They know us as {one.partyName} ({one.partyCode}).
                    <span className="block text-[11px] text-slate-400">Sent {fmtDate(one.invitedAt)} by {one.invitedBy}</span>
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <ActionForm action={acceptLinkAction} submitLabel="Accept" size="sm" hidden={{ linkId: one.id }}>
                      <Field label="A note for them" hint="optional"><input name="note" className={inputCls} /></Field>
                    </ActionForm>
                    <ActionForm action={refuseLinkAction} submitLabel="Refuse" size="sm" variant="secondary" hidden={{ linkId: one.id }}>
                      <Field label="Why" required><input name="note" required className={inputCls} /></Field>
                    </ActionForm>
                  </div>
                </li>
              ))}
          </ul>
        </Sheet>
      ) : null}

      {mergesWaiting || claimsWaiting ? (
        <Sheet title="Waiting for our answer" tone="waiting" note="other organizations ask us to agree">
          <p className="px-5 py-3 text-xs leading-5 text-slate-700 sm:px-6">
            {mergesWaiting ? <>{mergesWaiting} merge{mergesWaiting === 1 ? "" : "s"} of organizations to agree or refuse. </> : null}
            {claimsWaiting ? <>{claimsWaiting} claim{claimsWaiting === 1 ? "" : "s"} on entries we made, to vouch for or refuse. </> : null}
            <Link href="/organization/identity" className="font-semibold text-link hover:underline">Answer them</Link>
          </p>
        </Sheet>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Tile icon={FolderKanban} title="Projects" href="/organization/projects"
          figure={`${projects.filter((p) => p.status === "ACTIVE").length} open · ${projects.filter((p) => p.status !== "ACTIVE").length} archived`}
          note={joined.length ? `and ${joined.length} of other organizations` : "ours, opened by us"}>
          {mineOurs.length || mineJoined.length ? (
            <ul className="space-y-0.5">
              {mineOurs.slice(0, 5).map((p) => (
                <li key={p.id}>
                  <form action={switchProjectAction}>
                    <input type="hidden" name="projectId" value={p.id} />
                    <button type="submit" className="group/p flex w-full items-baseline gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-tint-soft" title={`Open ${p.code}`}>
                      <span className="font-mono text-xs font-semibold text-link">{p.code}</span>
                      <span className="truncate text-xs text-slate-600">{p.name}</span>
                    </button>
                  </form>
                </li>
              ))}
              {mineJoined.slice(0, Math.max(0, 5 - mineOurs.length)).map((p) => (
                <li key={`${p.linkId}-${p.projectId}`}>
                  <form action={switchOrganizationAction}>
                    <input type="hidden" name="tenantId" value={p.hostTenantId} />
                    <input type="hidden" name="projectId" value={p.projectId} />
                    <button type="submit" className="flex w-full items-baseline gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-tint-soft" title={`Open ${p.code} at ${p.hostOrganization}`}>
                      <span className="font-mono text-xs font-semibold text-link">{p.code}</span>
                      <span className="truncate text-xs text-slate-600">{p.name}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-slate-500">{p.hostOrganization}</span>
                    </button>
                  </form>
                </li>
              ))}
              {mineOurs.length + mineJoined.length > 5 ? <li className="px-1 text-[11px] text-slate-500">and {mineOurs.length + mineJoined.length - 5} more you are on</li> : null}
            </ul>
          ) : <p className="text-[11.5px] text-slate-500">You are on none of them yet.</p>}
        </Tile>

        <Tile icon={Users} title="People" href="/organization/people"
          figure={`${activePeople} can sign in${ours.length - activePeople ? ` · ${ours.length - activePeople} switched off` : ""}`}
          note={`${ours.filter((u) => u.mfa).length} with two-step sign-in`}>
          {scope.projectCount ? <Link href="/settings/users" className="text-[11.5px] font-semibold text-link hover:underline">Add someone, in People &amp; access</Link> : null}
        </Tile>

        <Tile icon={Building2} title="Organizations we work with" href="/organization/organizations"
          figure={`${outside.filter((p) => p.active).length} organizations`}
          note={`${linked} linked to their own DELIOS${received.length ? ` · ${received.length} invitation${received.length === 1 ? "" : "s"} to answer` : ""}`} />

        <Tile icon={Settings2} title="Settings" href="/organization/settings"
          figure={`${switches.length - freeCount} fixed · ${freeCount} free`}
          note="fixed: every project uses ours · free: a project may change it" />

        <Tile icon={Route} title="Defaults for new projects" href="/organization/defaults"
          figure={defaults ? (defaults.fromProject ? `Taken from ${defaults.fromProject}` : "Set here") : "The app's own"}
          note={defaults ? `${changedCount} answer${changedCount === 1 ? "" : "s"} differ from the app's · ${fmtDate(defaults.at)}` : "nothing changed yet"} />

        <Tile icon={BadgeCheck} title="Who we are on DELIOS" href="/organization/identity"
          figure={own ? `${own.code} · ${own.number ? "identifier given" : own.noIdentifierReason ? "no identifier, said why" : "identifier not given yet"}` : "—"}
          note={own?.domain ? (own.domainConfirmedAt ? `${own.domain}, proven` : `${own.domain}, not proven yet`) : "no email domain yet"} />

        <Tile icon={FileClock} title="What is kept about people's activity" href="/organization/tracking"
          figure={reading ? "Who opened and downloaded: kept" : "Who opened and downloaded: not kept"}
          note={signIns ? "sign-ins shown on a person's activity" : "sign-ins kept for security only"} />

        {scope.projectCount ? (
          <Tile icon={ScrollText} title="Sign-in & audit" href="/settings/audit"
            figure="The record of every act" note="across our projects">
            <Link href="/settings/security" className="text-[11.5px] font-semibold text-link hover:underline">Sign-in &amp; security</Link>
          </Tile>
        ) : null}
      </div>
    </>
  );
}

/** One part of the organization: its name (opening its page), its figure, a line about it, and its quickest ways in. */
function Tile({ icon: Icon, title, href, figure, note, children }: {
  icon: LucideIcon; title: string; href: string; figure: string; note?: string; children?: React.ReactNode;
}) {
  return (
    <section className="register register-sheet flex flex-col px-4 py-3.5">
      <Link href={href} className="group flex gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-tint text-brand-ink">
          <Icon className="h-4.5 w-4.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold leading-5 text-slate-900 group-hover:text-link">{title}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-500 transition group-hover:text-link" aria-hidden="true" />
          </span>
          <span className="mt-0.5 block text-[13px] font-medium tabular-nums text-slate-800">{figure}</span>
          {note ? <span className="block text-[11px] leading-4 text-slate-500">{note}</span> : null}
        </span>
      </Link>
      {children ? <div className="mt-2.5 border-t border-line pt-2.5 pl-12">{children}</div> : null}
    </section>
  );
}
