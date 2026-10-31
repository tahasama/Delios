import { Select } from "@/components/select";
import { Fragment } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { DataTable, Th, Td, ToneChip, Field } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { Switch, SwitchControl } from "@/components/switch";
import { getActiveSet } from "@/lib/settings/config";
import { adminUsers, adminFunctions, adminProjects } from "@/lib/settings/api-admin";
import { setSignInAction, savePersonEverywhereAction, setPasswordAction, forgetPersonAction } from "@/lib/organization/forms";
import { cn, fmtDate, fmtDateTime, timeAgo } from "@/lib/core/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "People" };

const field = "plain w-full";

type Search = { who?: string; open?: string };
type Who = "all" | "ours" | "guests" | "linked";
type User = Awaited<ReturnType<typeof adminUsers>>[number];

/**
 * Everyone with an account here (owner): ours, the people of other organizations we made accounts for, and those who
 * joined from their own DELIOS. Each line: their organization, the projects they are on with their function, since
 * when, their last sign-in, and "Can sign in", a switch acting at once. A name opens the person under their line, in
 * place, ready to change (owner: the organization's level controls everything; one panel, never a form behind a card):
 * name, email, administrator, and every project with its function, department and whether they stay on it. The panel
 * shows no sign-ins or acts (owner: we are not monitoring people).
 */
export default async function OrganizationPeoplePage({ searchParams }: { searchParams: Promise<Search> }) {
  const scope = await requireOrgAdmin();
  const sp = await searchParams;
  const [users, functions, projects, disciplines] = await Promise.all([
    adminUsers().catch(() => []),
    adminFunctions().then((all) => all.filter((one) => one.active).sort((a, b) => a.name.localeCompare(b.name))).catch(() => []),
    adminProjects().then((all) => all.filter((one) => one.status !== "ARCHIVED").sort((a, b) => a.code.localeCompare(b.code))).catch(() => []),
    getActiveSet("DISCIPLINES").then((all) => all.map((one) => ({ code: one.code, label: one.label })).sort((x, y) => x.label.localeCompare(y.label))).catch(() => []),
  ]);
  const whoOf = (u: User): Exclude<Who, "all"> => (u.internal ? "ours" : u.linked ? "linked" : "guests");
  const counts = { all: users.length, ours: 0, guests: 0, linked: 0 };
  for (const u of users) counts[whoOf(u)]++;
  const who: Who = sp.who === "ours" || sp.who === "guests" || sp.who === "linked" ? sp.who : "all";
  const shown = users
    .filter((u) => who === "all" || whoOf(u) === who)
    // Ours first, then by name: switching someone off never moves their line.
    .sort((a, b) => Number(b.internal) - Number(a.internal) || a.name.localeCompare(b.name));
  const signingIn = users.filter((u) => u.active && !u.linked).length;
  const href = (q: Search, anchor?: string) => {
    const next = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1] && e[1] !== "all"));
    return `/organization/people${next.size ? `?${next}` : ""}${anchor ? `#${anchor}` : ""}`;
  };
  const TABS: { key: Who; label: string }[] = [
    { key: "all", label: "Everyone" }, { key: "ours", label: "Ours" }, { key: "guests", label: "Accounts we made" }, { key: "linked", label: "From their own DELIOS" },
  ];

  return (
    <>
      <header className="register register-sheet register-sheet-open">
        <div className="px-5 pt-5 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">People</h1>
          <p className="plate-meta mt-1.5 font-normal">
            {counts.ours} of ours · {counts.guests} with accounts from us · {counts.linked} from their own DELIOS · {signingIn} can sign in here
          </p>
        </div>
        <nav aria-label="Whose people" className="seg mx-5 mb-4 w-fit max-w-full sm:mx-6">
          {TABS.map((t) => (
            <Link key={t.key} href={href({ who: t.key })} aria-current={who === t.key ? "page" : undefined} className="segment">
              {t.label}<span className="segment-n">{counts[t.key]}</span>
            </Link>
          ))}
        </nav>
      </header>

      <section className="register register-sheet register-sheet-open" aria-label="People">
        <DataTable className="rounded-none border-0 shadow-none" toolbar={false}
          head={<tr><Th>Name</Th><Th>Organization</Th><Th>Projects</Th><Th>Account since</Th><Th>Last sign-in</Th><Th className="text-right">Can sign in</Th></tr>}>
          {shown.map((u) => {
            const open = sp.open === u.id;
            const seats = u.memberships.filter((m) => m.active);
            const Chevron = open ? ChevronDown : ChevronRight;
            const me = u.id === scope.user.id;
            return (
              <Fragment key={u.id}>
                <tr id={`person-${u.id}`} className={cn("scroll-mt-20 align-top target:bg-tint-soft", !u.active && "opacity-60", open && "bg-tint-soft [&>td]:border-b-0")}>
                  <Td>
                    <Link href={href({ who, open: open ? undefined : u.id }, `person-${u.id}`)} scroll={false} aria-expanded={open}
                      title={open ? "Close" : `Open ${u.name} to change`} className="group inline-flex items-start gap-1 text-left">
                      <Chevron className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 group-hover:text-link" aria-hidden="true" />
                      <span className="text-[13px] font-medium text-slate-800 group-hover:text-link group-hover:underline">{u.name}</span>
                    </Link>
                    {u.isAdmin ? <span className="ml-1.5"><ToneChip tone="moving">administrator</ToneChip></span> : null}
                    <span className="block pl-5 text-[11px] text-slate-500">{u.email}</span>
                    {u.lockedUntil && new Date(u.lockedUntil) > new Date() ? <span className="block pl-5 text-[11px] font-semibold text-amber-700">locked until {fmtDateTime(u.lockedUntil)}</span> : null}
                  </Td>
                  <Td className="text-xs">
                    {u.internal ? <span className="text-slate-700">{scope.organization.name}</span> : (
                      <>
                        <code className="code-chip mr-1">{u.partyCode}</code>{u.partyName}
                        <span className="block text-[11px] text-slate-500">{u.linked ? `from its own DELIOS${u.homeFunction ? ` · ${u.homeFunction}` : ""}` : "account from us"}</span>
                      </>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {seats.length ? (
                      <ul className="space-y-0.5">
                        {seats.map((m) => (
                          <li key={m.id}><code className="code-chip mr-1.5">{m.projectCode}</code><span className="text-slate-600">{m.functionName}</span></li>
                        ))}
                      </ul>
                    ) : <span className="text-slate-500">on no project</span>}
                  </Td>
                  <Td className="text-xs whitespace-nowrap">{fmtDate(u.createdAt)}</Td>
                  <Td className="text-xs whitespace-nowrap">
                    {u.linked ? <span className="text-slate-500">at home</span>
                      : u.lastSignInAt ? <span title={fmtDateTime(u.lastSignInAt)}>{timeAgo(u.lastSignInAt)}</span> : <span className="text-slate-500">never</span>}
                  </Td>
                  <Td className="w-px whitespace-nowrap text-right">
                    {u.linked ? <span className="text-[11px] text-slate-500">signs in at home</span> : me ? <span className="text-[11px] text-slate-500">you</span> : (
                      <form action={setSignInAction} className="inline-flex">
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="active" value={u.active ? "off" : "on"} />
                        <Switch on={u.active} label={u.active ? `${u.name} can sign in: switch off` : `${u.name} cannot sign in: switch on`} />
                      </form>
                    )}
                  </Td>
                </tr>
                {open ? (
                  <tr>
                    <td colSpan={6} className="open-in border-b border-line bg-tint-soft p-0">
                      <PersonPanel user={u} me={me} functions={functions} projects={projects} disciplines={disciplines} close={href({ who }, `person-${u.id}`)} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </DataTable>
        {shown.length ? null : <p className="px-5 py-4 text-xs text-slate-500 sm:px-6">Nobody here yet.</p>}
        <p className="border-t border-line px-5 py-2.5 text-[11px] text-slate-500 sm:px-6">
          Switched off, a person can no longer sign in, on any project; everything they did stays. A name opens the person to change anything about them.
        </p>
      </section>
    </>
  );
}

/**
 * The person, open under their line: a few facts, then everything that changes, in one form saved once (who they are,
 * administrator, each project's function, department and whether they stay on it, another project to put them on).
 */
function PersonPanel({ user: u, me, functions, projects, disciplines, close }: {
  user: User; me: boolean; functions: { id: string; name: string }[]; projects: { id: string; code: string; name: string }[];
  disciplines: { code: string; label: string }[]; close: string;
}) {
  const seats = [...u.memberships].sort((a, b) => Number(b.active) - Number(a.active) || a.projectCode.localeCompare(b.projectCode));
  const elsewhere = projects.filter((p) => !u.memberships.some((m) => m.projectId === p.id));
  const departmentSelect = (name: string, value: string | null) => (
    <Select name={name} defaultValue={value ?? ""} className={field}>
      <option value="">None</option>
      {disciplines.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
    </Select>
  );
  const fact = (term: string, value: React.ReactNode) => (
    <div className="px-5 py-3 sm:px-6">
      <dt className="stencil text-slate-500">{term}</dt>
      <dd className="mt-1 text-[13px] font-medium text-slate-900">{value}</dd>
    </div>
  );

  return (
    <div className="border-t border-line">
      <dl className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {fact("Account made", fmtDate(u.createdAt))}
        {fact("Two-step sign-in", u.linked ? "At home" : u.mfa ? "On" : "Off")}
        {fact("Projects", `${u.memberships.filter((m) => m.active).length} now · ${u.memberships.length} in all`)}
      </dl>
      <ActionForm id={`person-form-${u.id}`} action={savePersonEverywhereAction} hideSubmit hidden={{ userId: u.id }}
        className="asking space-y-5 border-t border-line bg-surface px-5 py-5 sm:px-6">
        {u.linked ? (
          <p className="text-xs leading-5 text-slate-600">
            {u.name} works here from {u.partyName ?? "their organization"}&rsquo;s own DELIOS: their name, email and sign-in are theirs. Their projects, functions and departments change here.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Field label="Name" required><input name="name" required defaultValue={u.name} autoComplete="off" className={field} /></Field>
            <Field label="Email" required hint="signs them in; their notices go there"><input type="email" name="email" required defaultValue={u.email} autoComplete="off" className={field} /></Field>
            {u.internal && !me ? (
              <Field label="Administrator" hint="changes the organization's space and Settings">
                <input type="hidden" name="sendsAdmin" value="1" />
                <span className="flex h-(--control-h) items-center"><SwitchControl name="isAdmin" defaultChecked={u.isAdmin} /></span>
              </Field>
            ) : null}
          </div>
        )}
        <div>
          <p className="stencil mb-2 text-slate-500">Projects</p>
          {seats.length ? (
            <div className="overflow-x-auto rounded-md ring-1 ring-line">
              <table className="w-full text-left text-xs">
                <thead className="bg-tint-soft text-slate-500">
                  <tr>{["Project", "Function", "Department", "Since", "On the project"].map((h) => <th key={h} className="stencil px-3 py-2 font-normal">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {seats.map((m) => (
                    <tr key={m.id} className={m.active || m.pendingSince ? undefined : "[&>td:first-child]:opacity-60"}>
                      <td className="px-3 py-2 whitespace-nowrap"><code className="code-chip mr-1.5">{m.projectCode}</code><span className="text-slate-700">{m.projectName}</span></td>
                      {m.pendingSince ? (
                        <td colSpan={4} className="px-3 py-2 text-slate-500">
                          <ToneChip tone="waiting">waiting</ToneChip> <span className="ml-1">{m.functionName}, to be confirmed by {m.confirmerName ?? "whoever holds Manage"}</span>
                        </td>
                      ) : (
                        <>
                          <td className="min-w-48 px-3 py-2">
                            <Select name={`fn:${m.projectId}`} defaultValue={m.functionId} className={field}>
                              {functions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </Select>
                          </td>
                          <td className="min-w-40 px-3 py-2">{departmentSelect(`dep:${m.projectId}`, m.department)}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-600">{m.since ? fmtDate(m.since) : "—"}</td>
                          <td className="px-3 py-2">
                            <SwitchControl name={`on:${m.projectId}`} defaultChecked={m.active} />
                            {m.refusedReason ? <span className="mt-0.5 block text-[11px] text-slate-500">refused: {m.refusedReason}</span> : null}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-xs text-slate-500">On no project yet.</p>}
        </div>
        {elsewhere.length ? (
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Field label="Put on another project" hint="optional">
              <Select name="newProject" defaultValue="" className={field}>
                <option value="">None</option>
                {elsewhere.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </Select>
            </Field>
            <Field label="Function there">
              <Select name="newFunction" defaultValue="" className={field}>
                <option value="">Choose…</option>
                {functions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            </Field>
            <Field label="Department there">{departmentSelect("newDepartment", null)}</Field>
          </div>
        ) : null}
      </ActionForm>
      {!u.linked && !me ? (
        <ActionForm action={setPasswordAction} hidden={{ userId: u.id }} submitLabel="Set password" resetOnSuccess
          className="asking space-y-3 border-t border-line bg-surface px-5 py-4 sm:px-6">
          <p className="stencil text-slate-500">Set a password</p>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Field label="New password" hint="the organization's password rules apply">
              <input type="password" name="password" autoComplete="new-password" className={field} />
            </Field>
            <Field label="Once more"><input type="password" name="again" autoComplete="new-password" className={field} /></Field>
          </div>
          <p className="text-[11px] leading-4 text-slate-500">
            {u.name} is told at once, by email and on Notifications, and signed out everywhere. Give them the password yourself; they may choose their own with &ldquo;Forgot password&rdquo;.
          </p>
        </ActionForm>
      ) : null}
      {/* Asked to be forgotten (GDPR Article 17): their name and email replaced, the account closed; what they did stays. */}
      {!u.linked && !me ? (
        <details className="border-t border-line bg-surface">
          <summary className="cursor-pointer px-5 py-3 text-xs font-semibold text-slate-500 hover:text-slate-800 sm:px-6">Forget {u.name}…</summary>
          <ActionForm action={forgetPersonAction} hidden={{ userId: u.id }} submitLabel={`Forget ${u.name}`} variant="danger"
            confirmText={`${u.name}'s name and email are replaced for good and the account is closed. It cannot be undone.`}
            className="asking space-y-3 px-5 pb-4 sm:px-6">
            <p className="text-[11px] leading-4 text-slate-500">
              For a person who asked to be forgotten. Their name and email are replaced (&ldquo;Former user …&rdquo;), the account is closed, their sign-in,
              devices and pop-ups go. What they did stays in the records, under the name it was done by: the register has to prove who did what (GDPR
              Article 17(3)). Tell them so in your answer.
            </p>
            <Field label="Why" required hint="who asked, and when"><input name="why" required className={field} /></Field>
          </ActionForm>
        </details>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
        <Link href={close} scroll={false} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Close</Link>
        <button type="submit" form={`person-form-${u.id}`} data-on="true" className="ask">Save</button>
      </div>
    </div>
  );
}
