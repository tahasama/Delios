import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/core/scope";
import { PageHeader, Card, DataTable, Th, Td, Chip, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { Asked, Added } from "@/components/policy-fields";
import { formPolicy } from "@/lib/settings/field-policy";
import { savePartyAction, deletePartyAction } from "@/lib/reviews/forms";
import { PartyKindFields } from "./party-fields";
import { PARTY_KINDS } from "@/lib/settings/party-kinds";
import { adminFunctions, adminUsers, partiesWithAnswers } from "@/lib/settings/api-admin";
import { projectOrganizations } from "@/lib/organization/api";
import { inviteOrganizationAction, endLinkAction, setProjectOrganizationAction } from "@/lib/organization/forms";
import { contractRoleOptions } from "@/lib/settings/contract-roles";
import { NoAccess } from "../no-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organizations" };

// §0.3 — our organization and the external parties it exchanges information with.
export default async function AdminPartiesPage() {
  const ctx = await requireScope();
  const { user: me } = ctx;
  const policy = await formPolicy(ctx, "PARTY");
  if (!maySetup(me, SETUP_PAGES.find((p) => p.href === "/settings/parties")!)) return <NoAccess title="Organizations" who="control" />;
  const [parties, onProject, roles] = await Promise.all([
    partiesWithAnswers(),
    projectOrganizations(ctx),
    contractRoleOptions(),
  ]);
  const allFunctions = (await adminFunctions()).filter((one) => one.active).sort((a, b) => a.name.localeCompare(b.name));
  const people = (await adminUsers()).filter((one) => one.active).map((one) => ({ id: one.id, name: one.name, email: one.email, partyId: one.partyId }));
  // A function is named on an organization by its code: the one that carries its exchange.
  const functions = (await adminFunctions()).map((one) => ({ id: one.code, name: one.name })).sort((a, b) => a.name.localeCompare(b.name));

  const KINDS = PARTY_KINDS;
  /** How many people this organization has here. Everyone here signs in. */
  const signingIn = (partyId: string) => people.filter((person) => person.partyId === partyId).length;
  /** Collaborator, guest or not on DELIOS, as the backend reads it. */
  const kindOf = (party: { kind: string }) => party.kind;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Organizations"
        subtitle="Yours, and the others you exchange documents with. Their people are added in People & access."
      />
      <div className="space-y-4">
        <div className="space-y-4">
          <Card title={`Organizations (${parties.length})`}>
            <DataTable head={<tr><Th>Code</Th><Th>Name</Th><Th>Type</Th><Th label="How they work with us">How they work with us</Th><Th>Who answers for it</Th><Th>People</Th><Th></Th></tr>}>
              {parties.map((p) => (
                <tr key={p.id} id={`party-${p.id}`} className={p.active ? "scroll-mt-20 align-top target:bg-tint-soft" : "scroll-mt-20 align-top opacity-60 target:bg-tint-soft"}>
                  <Td className="font-mono text-xs font-semibold">{p.code}</Td>
                  <Td>{p.name}</Td>
                  <Td><Chip className={p.isInternal ? "bg-sky-100 text-sky-800 ring-sky-300" : "bg-violet-100 text-violet-800 ring-violet-300"}>{p.isInternal ? "our organization" : "external"}</Chip></Td>
                  <Td className="text-xs">
                    {p.isInternal ? <span className="text-slate-500">—</span> : (
                      <>
                        <span className="font-medium text-slate-700">{KINDS.find((k) => k.value === kindOf(p))?.label}</span>
                        <span className="block max-w-56 text-[11px] leading-4 text-slate-500">{KINDS.find((k) => k.value === kindOf(p))?.hint}</span>
                        {p.link ? (
                          <span className="mt-1 block text-[11px] font-semibold text-slate-600">
                            {p.link.state === "LINKED" ? `Linked to ${p.link.organization}` : `Invited to link: ${p.link.organization} has not answered yet`}
                          </span>
                        ) : null}
                      </>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {p.contact ? (
                      <>
                        <a href={`/settings/users#${p.contact.id}`} className="font-semibold text-link hover:underline">{p.contact.name}</a>
                        {p.backup ? <span className="block text-[11px] text-slate-500">backup: {p.backup.name}</span> : <span className="block text-[11px] text-slate-500">no backup</span>}
                      </>
                    ) : p.isInternal ? <span className="text-slate-500">—</span> : <span className="font-semibold text-amber-700">nobody named</span>}
                  </Td>
                  <Td className="tabular-nums text-xs">
                    {p._count.users
                      ? <a href={`/settings/users?org=${p.id}`} className="font-semibold text-link hover:underline">{p._count.users}</a>
                      : <span className="text-slate-500">0</span>}
                    {p.active ? null : <span className="block text-[11px] font-semibold text-red-700">access revoked</span>}
                  </Td>
                  <Td>
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-link">Edit</summary>
                      <div className="mt-2 w-80">
                        <ActionForm action={savePartyAction} submitLabel="Save" size="sm" hidden={{ id: p.id }}>
                          <Field label="Name" required><input name="name" required defaultValue={p.name} className={inputCls} /></Field>
                          <Field label="Code" required hint="documents and transmittals already issued keep the old code — only what comes next uses this one">
                            <input name="code" required maxLength={20} defaultValue={p.code} className={inputCls} />
                          </Field>
                          {p.isInternal ? null : (
                            <PartyKindFields
                              kind={kindOf(p)}
                              contactId={p.contactId ?? ""}
                              backupId={p.backupId ?? ""}
                              liaisonFunction={p.liaisonFunction ?? ""}
                              contactEmail={p.contactEmail ?? ""}
                              people={people.filter((u) => u.partyId === p.id)}
                              functions={functions}
                              access={{ active: p.active, signingIn: signingIn(p.id) }}
                            />
                          )}
                          {p.isInternal ? <input type="hidden" name="active" value="on" /> : null}
                        </ActionForm>
                        {!p.isInternal && p.active ? (
                          <div className="mt-3 border-t border-line pt-3">
                            {p.link ? (
                              <ActionForm action={endLinkAction} submitLabel={p.link.state === "LINKED" ? "End the link" : "Take back the invitation"} size="sm" variant="secondary" hidden={{ linkId: p.link.id }}>
                                <p className="text-xs text-slate-500">
                                  {p.link.state === "LINKED"
                                    ? `Their people stop working here with their own accounts. Everything they did stays under ${p.code}.`
                                    : `${p.link.organization} has not answered yet.`}
                                </p>
                                <Field label="Why" required><input name="note" required className={inputCls} /></Field>
                              </ActionForm>
                            ) : (
                              <ActionForm action={inviteOrganizationAction} submitLabel="Invite them to link" size="sm" variant="secondary" hidden={{ partyId: p.id }}>
                                <p className="text-xs text-slate-500">
                                  If {p.name} has its own DELIOS, its people can work here with their own accounts. Their administrator accepts.
                                  Nothing they did as {KINDS.find((k) => k.value === kindOf(p))?.label.toLowerCase()} is lost.
                                </p>
                                <Field label="Email of someone you know there" required><input type="email" name="email" required className={inputCls} /></Field>
                              </ActionForm>
                            )}
                          </div>
                        ) : null}
                        {!p.isInternal && p._count.users === 0 ? (
                          <div className="mt-3 border-t border-line pt-3">
                            <ActionForm action={deletePartyAction} submitLabel="Remove this organization" size="sm" variant="danger" hidden={{ id: p.id }}>
                              <p className="text-xs text-slate-500">It has nobody, so it can be removed outright. Once it holds a person, a step, a document or a transmittal, revoke its access instead.</p>
                            </ActionForm>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  </Td>
                </tr>
              ))}
            </DataTable>
          </Card>
        </div>
        {/* Which organizations take part in this project, the role each plays, and the function a collaborator's people start with. */}
        <Card title={`On ${ctx.project.code}: organizations taking part (${onProject.filter((one) => one.active).length})`}>
          {onProject.length ? (
            <DataTable head={<tr><Th>Organization</Th><Th>How they work with us</Th><Th>Role here</Th><Th>Their people start as</Th><Th>People here</Th><Th></Th></tr>}>
              {onProject.map((one) => (
                <tr key={one.partyId} className={one.active ? "align-top" : "align-top opacity-60"}>
                  <Td><span className="font-mono text-xs font-semibold">{one.code}</span> <span className="text-xs text-slate-600">{one.name}</span></Td>
                  <Td className="text-xs">{KINDS.find((k) => k.value === (one.kind === "NOT_ON_DELIOS" ? "OFFLINE" : one.kind))?.label}{one.linkedOrganization ? <span className="block text-[11px] text-slate-500">{one.linkedOrganization}</span> : null}</Td>
                  <Td className="text-xs">{one.role ? roles.find((r) => r.code === one.role)?.label ?? one.role : <span className="text-slate-500">not stated</span>}</Td>
                  <Td className="text-xs">{one.startFunction ?? (one.kind === "COLLABORATOR" ? <span className="font-semibold text-amber-700">not said yet</span> : <span className="text-slate-500">—</span>)}</Td>
                  <Td className="tabular-nums text-xs">{one.people}</Td>
                  <Td>
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-link">Edit</summary>
                      <div className="mt-2 w-72">
                        <ActionForm action={setProjectOrganizationAction} submitLabel="Save" size="sm" hidden={{ partyId: one.partyId }}>
                          <Field label="Role here" hint="optional"><select name="role" defaultValue={one.role ?? ""} className={inputCls}><option value="">Not stated</option>{roles.filter((r) => r.code !== "GENERIC").map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</select></Field>
                          <Field label="Their people start as" hint="a collaborator's administrator puts their people on; this is the function they get"><select name="startFunctionId" defaultValue={one.startFunctionId ?? ""} className={inputCls}><option value="">Not said</option>{allFunctions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
                          <Field label="Takes part"><select name="active" defaultValue={one.active ? "on" : "off"} className={inputCls}><option value="on">Yes</option><option value="off">No longer</option></select></Field>
                        </ActionForm>
                      </div>
                    </details>
                  </Td>
                </tr>
              ))}
            </DataTable>
          ) : <p className="text-xs text-slate-500">No other organization is said to take part yet.</p>}
          <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-link">+ An organization takes part</summary>
            <div className="mt-2 max-w-md">
              <ActionForm action={setProjectOrganizationAction} submitLabel="Add" size="sm">
                <Field label="Organization" required><select name="partyId" required defaultValue="" className={inputCls}><option value="" disabled>Choose…</option>{parties.filter((p) => !p.isInternal && p.active && !onProject.some((o) => o.partyId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select></Field>
                <Field label="Role here" hint="optional"><select name="role" defaultValue="" className={inputCls}><option value="">Not stated</option>{roles.filter((r) => r.code !== "GENERIC").map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</select></Field>
                <Field label="Their people start as" hint="for a collaborator: the function its people get here"><select name="startFunctionId" defaultValue="" className={inputCls}><option value="">Not said</option>{allFunctions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
              </ActionForm>
            </div>
          </details>
        </Card>

        <details className="rounded-md border border-line bg-surface px-5 py-3"><summary className="cursor-pointer text-sm font-semibold text-brand-ink">+ Add an organization</summary><div className="mt-3 max-w-2xl">
          <ActionForm action={savePartyAction} submitLabel="Register this organization" size="sm">
            <p className="text-xs text-slate-500">
              Another organization you exchange documents with. Yours is already here, registered once at setup.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Asked policy={policy} field="code" hint="short, unique — e.g. Acme Pumps">
                {({ required }) => <input name="code" required={required} maxLength={20} className={inputCls} />}
              </Asked>
              <Asked policy={policy} field="name">
                {({ required }) => <input name="name" required={required} className={inputCls} />}
              </Asked>
              <Added fields={policy.own} />
            </div>
            <PartyKindFields kind="OFFLINE" contactId="" backupId="" liaisonFunction="" people={[]} functions={functions} />
            <p className="text-[11px] leading-4 text-slate-500">
              A collaborator or a guest needs accounts, created in <a href="/settings/users" className="font-semibold text-link hover:underline">People &amp; access</a> and attached to this organization; then you name the one who answers for it.
              An organization that is not on the EDMS needs nobody here: one of our functions carries it, and fills in its review, comments and answer with proof each time.
            </p>
          </ActionForm>
        </div></details>
      </div>
    </div>
  );
}
