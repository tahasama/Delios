import { Select } from "@/components/select";
import { controlDoes, CONFIRM_KEY, effectiveAnswer } from "@/lib/settings/control-activities";
import { SwitchControl } from "@/components/switch";
import Link from "next/link";
import { Fragment } from "react";
import { cn } from "@/lib/core/utils";
import { Bell, History, Pencil, Search, UserPlus, X } from "lucide-react";
import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/core/scope";
import { DataTable, Th, Td, Field, inputCls, ToneChip } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { savePersonAction, takeOffProjectAction } from "@/lib/settings/forms-admin";
import { holdersOf } from "@/lib/core/permissions";
import { api, projectPath } from "@/lib/client";
import { projectSettings } from "@/lib/settings/api";
import { projectOrganizations } from "@/lib/organization/api";
import { isAdmin } from "@/lib/core/auth";
import { adminFunctions, adminParties, adminProjects, adminUsers } from "@/lib/settings/api-admin";
import { getMe } from "@/lib/account/api";
import { getActiveSet } from "@/lib/settings/config";
import { noticesAbout, noticeHistory } from "@/lib/actions/api";
import { NotifyPanel } from "@/components/notify-panel";
import { fromToday } from "@/lib/core/days";
import { NoAccess } from "../no-access";
import { accessWords } from "@/lib/settings/access-words";
import { SomeoneJoins } from "./join-form";
import { JumpPick } from "@/components/jump-pick";

export const dynamic = "force-dynamic";
export const metadata = { title: "People & access" };

type Pending = {
  membershipId: string; userId: string; name: string; organization: string | null; function: string; department: string | null;
  since: string; proposedBy: string | null; confirmerId: string | null; confirmerName: string | null; mine: boolean;
};

/**
 * Who is on the project, in which function and department; and how someone joins it. Two switches of the project
 * (Control room): who adds (only the control function, the default, or everyone on the project, from the directory)
 * and whether whoever holds Manage confirms (necessary by default). Here: "Add someone" with an account, and "Ask for
 * someone to join" for someone new, with the email or letter it came on as proof. Confirmed, they are put on by
 * themselves and told; the control function may remind whoever confirms. The list: everyone, narrowed by organization
 * and project, each with their place here.
 */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ org?: string; project?: string; edit?: string; q?: string }> }) {
  const ctx = await requireScope();
  const { user: me, projectId, project } = ctx;
  const sp = await searchParams;
  const withControl = await controlDoes(ctx, "PROJECT_PEOPLE");
  if (!maySetup(me, SETUP_PAGES.find((p) => p.href === "/settings/users")!, !withControl)) {
    return <NoAccess title="People & access" who="control" />;
  }
  const [people, parties, projects, functions, disciplines, answers, managers, taking, pending] = await Promise.all([
    adminUsers(),
    adminParties(),
    // The control function works on the projects it is on; an administrator on any.
    adminProjects().catch(async () => (await getMe())?.projects ?? []).then((all) => all.filter((one) => one.status === "ACTIVE")),
    adminFunctions().then((all) => all.filter((one) => one.active).sort((a, b) => a.name.localeCompare(b.name))),
    getActiveSet("DISCIPLINES").then((all) => all.map((one) => ({ code: one.code, label: one.label })).sort((x, y) => x.label.localeCompare(y.label))),
    projectSettings(projectId).catch(() => new Map<string, string>()),
    holdersOf(ctx, "MANAGE").catch(() => []),
    projectOrganizations(ctx).catch(() => []),
    api<Pending[]>(projectPath(ctx, "/people/pending"), { keep: { areas: [] } }).catch(() => [] as Pending[]),
  ]);

  // Whether someone put on here goes straight on, or is asked first (the backend decides the same way).
  const admin = isAdmin(me);
  const mayAdd = admin || ctx.can("CONTROL") || (!withControl && me.isInternal);
  const confirmOn = effectiveAnswer(CONFIRM_KEY("PROJECT_PEOPLE"), answers.get(CONFIRM_KEY("PROJECT_PEOPLE"))) === "ON";
  const asks = !admin && (!mayAdd || confirmOn);

  const deptLabel = (code: string) => disciplines.find((d) => d.code === code)?.label ?? code;
  const takesPart = new Set(taking.filter((one) => one.active).map((one) => one.partyId));
  const ourParties = parties.filter((p) => p.isInternal && p.active);
  const guestParties = parties.filter((p) => !p.isInternal && p.active && p.kind !== "COLLABORATOR" && p.kind !== "NOT_ON_DELIOS" && p.participation !== "BY_PROXY");
  const onProject = people.filter((u) => u.active && u.memberships.some((m) => m.projectId === projectId && m.active));
  const notHere = people.filter((u) => u.active && !u.memberships.some((m) => m.projectId === projectId && (m.active || m.pendingSince)));
  const confirmers = [
    ...managers.map((m) => ({ id: m.id, name: m.name, detail: m.functionName, note: "recommended" })),
    ...onProject.filter((u) => !managers.some((m) => m.id === u.id))
      .map((u) => ({ id: u.id, name: u.name, detail: u.memberships.find((m) => m.projectId === projectId)?.functionName ?? null })),
  ];

  const users = [...people]
    .sort((x, y) => Number(y.active) - Number(x.active) || x.name.localeCompare(y.name))
    .map((one) => ({
      ...one,
      held: one.memberships.find((seat) => !seat.active && seat.projectId === projectId && (seat.pendingSince || seat.refusedAt)) ?? null,
      seats: one.memberships.filter((seat) => seat.active),
    }));
  const shownOrg = sp.org ? parties.find((party) => party.id === sp.org) ?? null : null;
  const projectFilter = sp.project && projects.some((item) => item.id === sp.project) ? sp.project : "";
  // Found by name or email (owner: fine for 9 people, needed for 90).
  const words = (sp.q ?? "").trim().toLowerCase();
  const shown = users.filter((person) =>
    (!shownOrg || person.partyId === shownOrg.id) && (!projectFilter || person.seats.some((seat) => seat.projectId === projectFilter))
    && (!words || `${person.name} ${person.email}`.toLowerCase().includes(words)));
  // "Other projects" only when someone shown is on another project: a column of dashes takes room for nothing.
  const showElsewhere = shown.some((person) => person.seats.some((seat) => seat.projectId !== projectId));
  const columns = showElsewhere ? 6 : 5;
  const refused = users.filter((u) => u.held?.refusedAt).length;

  // Reminding whoever confirms: one notice history per person waiting.
  const reminders = await Promise.all(pending.map(async (one) => ({ id: one.membershipId, history: noticeHistory(await noticesAbout(ctx, `join:${one.membershipId}`)) })));
  const editing = sp.edit ?? null;
  // A person's activity (everything they did, with its day) is read by an administrator or the control function.
  const mayReadActivity = admin || ctx.can("CONTROL");
  const chip = (q: Record<string, string | undefined>) => {
    if (sp.q && !("q" in q)) q = { ...q, q: sp.q };
    const next = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1]));
    return `/settings/users${next.size ? `?${next}` : ""}`;
  };

  return (
    <div className="space-y-4">
      {/* The masthead: who is here, and how someone joins; its acts on its right, the form opening under it. */}
      <SomeoneJoins
        projectCode={project.code}
        projectName={project.name}
        plate={<>
            <h1 className="plate-title text-slate-950">People &amp; access</h1>
            <p className="plate-meta mt-2">
              {onProject.length} on {project.code}
              {pending.length ? <> · <span className="text-amber-800">{pending.length} waiting to be confirmed</span></> : null}
              {refused ? <> · {refused} refused</> : null}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              {withControl ? `On ${project.code} only the control function adds people` : `On ${project.code} everyone on the project adds people, from the project directory`}
              {confirmOn
                ? "; whoever holds Manage confirms each one, and once confirmed they are put on by themselves and told by notification and email."
                : "; no confirmation: they are on at once, and told by notification and email."}
              {admin ? " As an administrator, what you add goes straight on." : ""}
              {" "}<Link href="/settings/flow#join/join-asked" className="font-semibold text-link hover:underline">Change it in the Control room</Link>.
            </p>
          </>}
        plateActs={<Link href="/import?kind=people" className="ask">Add a whole team from a spreadsheet</Link>}
        sentence={asks ? "asked first; confirmed, they are put on and told" : "they are put on at once and told"}
        mayAdd={mayAdd}
        people={notHere.map((u) => ({ id: u.id, name: u.name, detail: [u.partyName, u.email].filter(Boolean).join(" · ") }))}
        ourParties={ourParties.map((p) => ({ value: p.id, label: p.name }))}
        guestParties={guestParties.map((p) => ({ value: p.id, label: `${p.name}${takesPart.has(p.id) ? "" : ` (not taking part in ${project.code} yet)`}` }))}
        functions={functions.map((f) => ({ value: f.id, label: f.name, allows: accessWords(f.rules.flatMap((r) => r.verbs)) }))}
        disciplines={disciplines.map((d) => ({ value: d.code, label: d.label }))}
        confirmers={confirmers}
        asks={asks}
        mayKeepProof={ctx.can("CONTROL")}
        footnote={<>Someone whose company has its own DELIOS is not added here: link the two organizations on{" "}
          <Link href="/settings/parties" className="font-semibold text-link hover:underline">Organizations</Link>; their administrator puts them on.</>}
      />

      {/* Waiting to be confirmed: who, as what, since when, who confirms; the control function may remind them. */}
      {pending.length ? (
        <section className="register register-sheet register-sheet-open" aria-labelledby="pending-head">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span id="pending-head" className="stencil mr-1 text-slate-500">Waiting to be confirmed</span>
            <span className="text-[11px] text-slate-500">they join once confirmed, on People to confirm</span>
          </div>
          <ul className="divide-y divide-line">
            {pending.map((one) => {
              const history = reminders.find((r) => r.id === one.membershipId)?.history ?? { count: 0, daysSinceFirst: null, lastTo: [] };
              const askedOf = one.confirmerId ? [one.confirmerId] : managers.map((m) => m.id);
              return (
                <li key={one.membershipId} className="space-y-3 px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="text-sm font-semibold text-slate-800">
                      {one.name}
                      <span className="ml-1.5 text-xs font-normal text-slate-500">{[one.organization, one.function, one.department ? deptLabel(one.department) : null].filter(Boolean).join(" · ")}</span>
                    </p>
                    <ToneChip tone="waiting">waiting for {one.confirmerName ?? "whoever holds Manage"}</ToneChip>
                  </div>
                  <p className="text-xs leading-5 text-slate-600">
                    Asked by {one.proposedBy ?? "someone"}, {fromToday(one.since.slice(0, 10))?.toLowerCase() ?? one.since.slice(0, 10)}.{" "}
                    <Link href="/people/confirm" className="font-semibold text-link hover:underline">People to confirm</Link>
                  </p>
                  {ctx.can("CONTROL") && askedOf.length ? (
                    <details>
                      <summary className="ask w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden"><Bell aria-hidden className="h-3.5 w-3.5" /> Remind whoever confirms</summary>
                      <div className="mt-3">
                        <NotifyPanel
                          subject={`join:${one.membershipId}`}
                          title={`${one.name} waits to join ${project.code}`}
                          body={`${one.name} waits for your confirmation to join ${project.code} as ${one.function}. Please confirm or refuse it on People to confirm.`}
                          link="/people/confirm"
                          people={confirmers}
                          chosen={askedOf}
                          history={history}
                          bare
                        />
                      </div>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Everyone: narrowed by organization and project; each with their place here. */}
      <section className="register register-sheet register-sheet-open" aria-labelledby="list-head">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <span id="list-head" className="stencil mr-1 text-slate-500">{shownOrg ? shownOrg.name : "Everyone"}</span>
          <span className="text-[11px] text-slate-500">{shown.length} · function and department shown for {project.code}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-5 py-2.5 text-xs sm:px-6">
          {/* Organization and project as search fields (owner): a row of chips grows with every organization. */}
          <label className="flex items-center gap-2">
            <span className="stencil text-slate-500">Organization</span>
            <JumpPick label="Organization" className="w-56" items={[
              { href: chip({ project: projectFilter || undefined }), label: "All organizations", on: !shownOrg },
              ...parties.map((party) => ({ href: chip({ org: party.id, project: projectFilter || undefined }), label: party.name, detail: party.code, on: shownOrg?.id === party.id })),
            ]} />
          </label>
          {projects.length > 1 ? (
            <label className="flex items-center gap-2">
              <span className="stencil text-slate-500">Project</span>
              <JumpPick label="Project" className="w-44" items={[
                { href: chip({ org: shownOrg?.id }), label: "Any project", on: !projectFilter },
                ...projects.map((item) => ({ href: chip({ org: shownOrg?.id, project: item.id }), label: item.code, detail: item.name, on: projectFilter === item.id })),
              ]} />
            </label>
          ) : null}
          {/* Find a person: Enter applies; the organization and project chosen stay. */}
          <form className="asking ml-auto flex min-w-56 items-center gap-2">
            {shownOrg ? <input type="hidden" name="org" value={shownOrg.id} /> : null}
            {projectFilter ? <input type="hidden" name="project" value={projectFilter} /> : null}
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Find a person</span>
              <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input name="q" defaultValue={sp.q ?? ""} placeholder="Find a name or email" className="plain w-full !pl-7" />
            </label>
            {sp.q ? <Link href={chip({ org: shownOrg?.id, project: projectFilter || undefined, q: undefined })} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Clear</Link> : null}
          </form>
        </div>
        <DataTable empty={words || shownOrg ? "Nobody matches that. Clear the search or the organization to see everyone." : "Nobody is on the project yet. Add someone, or ask for someone to join, above."} className="rounded-none border-0 shadow-none" toolbar={false}
          head={<tr><Th>Person</Th><Th>Organization</Th><Th>On {project.code}</Th><Th>Department</Th>{showElsewhere ? <Th>Other projects</Th> : null}<Th></Th></tr>}>
          {shown.map((u) => {
            const here = u.seats.find((m) => m.projectId === projectId);
            const elsewhere = u.seats.filter((m) => m.projectId !== projectId);
            const open = !!here && editing === u.id;
            // Opening or closing a person's line keeps the narrowing as it is.
            const lineHref = (edit?: string) => `${chip({ org: shownOrg?.id, project: projectFilter || undefined, edit })}#person-${u.id}`;
            return (
              <Fragment key={u.id}>
                <tr id={`person-${u.id}`} className={cn("scroll-mt-20 align-top target:bg-tint-soft", !u.active && "opacity-60", open && "[&>td]:border-b-0")}>
                  <Td>
                    {mayReadActivity
                      ? <Link href={`/settings/users/${u.id}`} className="font-medium text-slate-800 hover:text-link hover:underline" title={`What ${u.name} did in the app`}>{u.name}</Link>
                      : <span className="font-medium text-slate-800">{u.name}</span>}
                    {u.id === me.id ? <span className="ml-1 text-xs text-slate-500">(you)</span> : null}
                    <span className="block text-[11px] text-slate-500">
                      {u.email}{u.linked ? " · works here from their own DELIOS" : ""}{u.active ? "" : " · can no longer sign in"}
                    </span>
                  </Td>
                  <Td className="text-xs">{u.partyName ?? "—"}</Td>
                  <Td className="text-xs">
                    {here ? here.functionName
                      : u.held?.pendingSince ? <ToneChip tone="waiting">{u.held.functionName} · waiting for {u.held.confirmerName ?? "whoever holds Manage"}</ToneChip>
                      : u.held?.refusedAt ? <span className="whitespace-pre-line text-red-700">{u.held.functionName} · refused by {u.held.refusedByName}: {u.held.refusedReason}</span>
                      : <span className="text-slate-500">not on it</span>}
                  </Td>
                  <Td className="text-xs">{here?.department ? deptLabel(here.department) : "—"}</Td>
                  {showElsewhere ? <Td className="text-xs">{elsewhere.length ? elsewhere.map((m) => `${m.projectCode} · ${m.functionName}`).join(", ") : "—"}</Td> : null}
                  <Td className="w-px whitespace-nowrap text-right">
                    {/* What they did in the app: the person's activity, for an administrator or the control function. */}
                    {mayReadActivity ? (
                      <Link href={`/settings/users/${u.id}`} className="inline-flex rounded-sm p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title={`What ${u.name} did in the app`}>
                        <History aria-label={`What ${u.name} did in the app`} className="h-4 w-4" />
                      </Link>
                    ) : null}
                    {here ? (
                      open ? (
                        <Link href={lineHref()} scroll={false} className="inline-flex rounded-sm p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Close">
                          <X aria-label={`Close ${u.name}`} className="h-4 w-4" />
                        </Link>
                      ) : (
                        <Link href={lineHref(u.id)} scroll={false} className="inline-flex rounded-sm p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title={`Change ${u.name}`}>
                          <Pencil aria-label={`Change ${u.name}`} className="h-4 w-4" />
                        </Link>
                      )
                    ) : u.held?.pendingSince ? null : u.active ? (
                      <Link href="#join" className="inline-flex rounded-sm p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title={`Ask for ${u.name} to join`}>
                        <UserPlus aria-label={`Ask for ${u.name} to join`} className="h-4 w-4" />
                      </Link>
                    ) : null}
                  </Td>
                </tr>
                {open && here ? (
                  // The person's line opened under it: the row itself goes on, the new-document form's way (grey
                  // fields side by side, then the strip with Cancel and Save), never a box inside the table.
                  <tr>
                    <td colSpan={columns} className="open-in border-b border-line p-0">
                      <ActionForm id={`person-form-${u.id}`} action={savePersonAction} hideSubmit hidden={{ userId: u.id, partyId: u.partyId ?? "" }}
                        className="asking space-y-5 px-5 py-5 sm:px-6">
                        {u.linked ? (
                          <p className="text-xs leading-5 text-slate-600">
                            {u.name} works here from their own organization&rsquo;s DELIOS: their name, email and sign-in are theirs. Only their place on {project.code} changes here.
                          </p>
                        ) : null}
                        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                          {u.linked ? null : (
                            <>
                              <Field label="Name" required><input name="name" required defaultValue={u.name} autoComplete="off" className="plain w-full" /></Field>
                              <Field label="Email" required hint="where their notices go"><input type="email" name="email" required defaultValue={u.email} autoComplete="off" className="plain w-full" /></Field>
                            </>
                          )}
                          <Field label={`Function on ${project.code}`} required>
                            <Select name="functionId" defaultValue={here.functionId} className="plain w-full">
                              {functions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </Select>
                          </Field>
                          <Field label="Department" hint="their discipline: told about actions, confirms going ahead">
                            <Select name="department" defaultValue={here.department ?? ""} className="plain w-full">
                              <option value="">None</option>
                              {disciplines.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                            </Select>
                          </Field>
                        </div>
                        {u.linked ? null : (
                          <label className="flex w-fit cursor-pointer items-center gap-2.5 text-xs font-medium text-slate-700">
                            <SwitchControl name="active" defaultChecked={u.active} />
                            Can sign in <span className="font-normal text-slate-500">— switched off, their account stops on every project</span>
                          </label>
                        )}
                      </ActionForm>
                      {u.id !== me.id ? (
                        <details className="border-t border-line px-5 py-3 sm:px-6">
                          <summary className="w-fit cursor-pointer list-none text-xs font-semibold text-slate-500 hover:text-slate-800 [&::-webkit-details-marker]:hidden">
                            Take {u.name} off {project.code}
                          </summary>
                          <ActionForm action={takeOffProjectAction} hideSubmit hidden={{ userId: u.id }} className="mt-3 space-y-3"
                            confirmText={`Take ${u.name} off ${project.code}? Their account and their other projects stay, and everything they did here keeps their name.`}>
                            <p className="text-xs leading-5 text-slate-600">
                              They leave {project.code} only. Their account and their other projects stay, and everything they did here keeps their name.
                            </p>
                            <button type="submit" className="ask">Take them off</button>
                          </ActionForm>
                        </details>
                      ) : null}
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
                        <Link href={lineHref()} scroll={false} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</Link>
                        {mayReadActivity ? (
                          <Link href={`/settings/users/${u.id}`} className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-link hover:underline">
                            <History aria-hidden className="h-3.5 w-3.5" /> See what {u.name} did
                          </Link>
                        ) : null}
                        <button type="submit" form={`person-form-${u.id}`} data-on="true" className="ask">Save</button>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </DataTable>
      </section>
    </div>
  );
}
