import { isAdmin } from "@/lib/auth";
import { SETUP_PAGES, maySetup } from "../setup-pages";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, DataTable, Th, Td, Chip, Field, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { Asked, Added } from "@/components/policy-fields";
import { formPolicy } from "@/lib/field-policy";
import { savePartyAction, deletePartyAction } from "@/lib/actions/workflow";
import { PartyKindFields } from "./party-fields";
import { PARTY_KINDS } from "@/lib/party-kinds";
import { adminFunctions, adminUsers, legacyParties } from "@/lib/api/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organizations" };

// §0.3 — our organization and the external parties it exchanges information with.
export default async function AdminPartiesPage() {
  const ctx = await requireScope();
  const { user: me } = ctx;
  const policy = await formPolicy(ctx, "PARTY");
  if (!maySetup(me, SETUP_PAGES.find((p) => p.href === "/settings/parties")!)) return <PageHeader title="Organizations" subtitle="Administrators and the control function." />;
  const [parties] = await Promise.all([
    legacyParties(),
  ]);
  const people = (await adminUsers()).filter((one) => one.active).map((one) => ({ id: one.id, name: one.name, email: one.email, partyId: one.partyId }));
  // A function is named on an organization by its code: the one that carries its exchange.
  const functions = (await adminFunctions()).map((one) => ({ id: one.code, name: one.name })).sort((a, b) => a.name.localeCompare(b.name));

  const KINDS = PARTY_KINDS;
  /** How many people this organization has here. Everyone here signs in. */
  const signingIn = (partyId: string) => people.filter((person) => person.partyId === partyId).length;
  /** Records written before the kinds existed still read correctly. */
  const kindOf = (party: { kind: string; participation: string }) =>
    party.participation && party.participation !== "IN_APP" ? "OFFLINE" : party.kind ?? "COLLABORATOR";

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
                <tr key={p.id} className={p.active ? "align-top" : "align-top opacity-60"}>
                  <Td className="font-mono text-xs font-semibold">{p.code}</Td>
                  <Td>{p.name}</Td>
                  <Td><Chip className={p.isInternal ? "bg-sky-100 text-sky-800 ring-sky-300" : "bg-violet-100 text-violet-800 ring-violet-300"}>{p.isInternal ? "our organization" : "external"}</Chip></Td>
                  <Td className="text-xs">
                    {p.isInternal ? <span className="text-slate-400">—</span> : (
                      <>
                        <span className="font-medium text-slate-700">{KINDS.find((k) => k.value === kindOf(p))?.label}</span>
                        <span className="block max-w-56 text-[11px] leading-4 text-slate-400">{KINDS.find((k) => k.value === kindOf(p))?.hint}</span>
                      </>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {p.contact ? (
                      <>
                        <a href={`/settings/users#${p.contact.id}`} className="font-semibold text-link hover:underline">{p.contact.name}</a>
                        {p.backup ? <span className="block text-[11px] text-slate-500">backup: {p.backup.name}</span> : <span className="block text-[11px] text-slate-400">no backup</span>}
                      </>
                    ) : p.isInternal ? <span className="text-slate-400">—</span> : <span className="font-semibold text-amber-700">nobody named</span>}
                  </Td>
                  <Td className="tabular-nums text-xs">
                    {p._count.users
                      ? <a href={`/settings/users?org=${p.id}`} className="font-semibold text-link hover:underline">{p._count.users}</a>
                      : <span className="text-slate-400">0</span>}
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
                              people={people.filter((u) => u.partyId === p.id)}
                              functions={functions}
                              access={{ active: p.active, signingIn: signingIn(p.id) }}
                            />
                          )}
                          {p.isInternal ? <input type="hidden" name="active" value="on" /> : null}
                        </ActionForm>
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
        <details className="rounded-2xl border border-line bg-surface px-5 py-3 shadow-sm"><summary className="cursor-pointer text-sm font-semibold text-brand-ink">+ Add an organization</summary><div className="mt-3 max-w-2xl">
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
            <p className="text-[11px] leading-4 text-slate-400">
              A collaborator or a guest needs accounts, created in <a href="/settings/users" className="font-semibold text-link hover:underline">People &amp; access</a> and attached to this organization; then you name the one who answers for it.
              An organization that is not on the EDMS needs nobody here: one of our functions carries it, and fills in its review, comments and answer with proof each time.
            </p>
          </ActionForm>
        </div></details>
      </div>
    </div>
  );
}
