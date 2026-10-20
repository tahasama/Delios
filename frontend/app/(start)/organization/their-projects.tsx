import { ActionForm } from "@/components/form";
import { DataTable, Th, Td, Chip, Field, inputCls } from "@/components/ui";
import { bringOverAction, endLinkAction } from "@/lib/organization/forms";
import { fmtDate } from "@/lib/core/utils";
import { Sheet } from "./sheet";

type Link = Awaited<ReturnType<typeof import("@/lib/organization/api").organizationLinks>>[number];
type Guest = { id: string; name: string; email: string };

/**
 * The organizations whose projects we work on, linked to us: since when, the guest accounts they made for our people
 * before we linked (brought over, they sign in here), ending the link with why; and the links refused or ended.
 * Shown on Organizations we work with.
 */
export function TheirProjectsLinks({ links, guestsThere }: { links: Link[]; guestsThere: Map<string, Guest[]> }) {
  const linked = links.filter((one) => one.side === "GUEST" && one.state === "LINKED");
  const history = links.filter((one) => one.state === "REFUSED" || one.state === "ENDED");
  if (!linked.length && !history.length) return null;
  return (
    <Sheet id="their-projects" title="Organizations whose projects we work on" note="linked to us: our people sign in here and work there">
      {linked.length ? (
        <DataTable className="rounded-none border-0 shadow-none" head={<tr><Th>Organization</Th><Th>How we work with them</Th><Th>The link</Th></tr>}>
            {linked.map((one) => (
              <tr key={one.id}>
                <Td className="text-xs text-slate-600">{one.organization}</Td>
                <Td className="text-xs">we work on their projects</Td>
                <Td className="text-xs">
                  linked since {fmtDate(one.answeredAt)}
                  {guestsThere.get(one.id)?.length ? (
                    <div className="mt-2 rounded-md bg-tint-soft p-2 ring-1 ring-line">
                      <p className="text-[11px] text-slate-600">Guest accounts {one.organization} made for our people before we linked. Brought over, they sign in here with the same password and keep their projects there.</p>
                      <ul className="mt-1 space-y-1">
                        {guestsThere.get(one.id)!.map((guest) => (
                          <li key={guest.id} className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-700">{guest.name} <span className="text-slate-400">{guest.email}</span></span>
                            <ActionForm action={bringOverAction} hideSubmit hidden={{ linkId: one.id, guestId: guest.id }} className="space-y-0">
                              <button className="text-[11px] font-semibold text-link hover:underline">bring over</button>
                            </ActionForm>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <details className="mt-1"><summary className="cursor-pointer text-[11px] font-semibold text-link">End the link</summary>
                    <div className="mt-2 w-72">
                      <ActionForm action={endLinkAction} submitLabel="End the link" size="sm" variant="secondary" hidden={{ linkId: one.id }}>
                        <p className="text-[11px] text-slate-500">Our people stop working on {one.organization}&rsquo;s projects. Everything they did there stays there.</p>
                        <Field label="Why" required><input name="note" required className={inputCls} /></Field>
                      </ActionForm>
                    </div>
                  </details>
                </Td>
              </tr>
            ))}
        </DataTable>
      ) : null}
          {history.length ? (
            <details className="border-t border-line px-5 py-2.5 sm:px-6"><summary className="cursor-pointer text-xs font-semibold text-link">Refused and ended ({history.length})</summary>
              <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
                {history.map((one) => (
                  <li key={one.id}>
                    <Chip className="bg-slate-100 text-slate-600 ring-slate-200">{one.state.toLowerCase()}</Chip>{" "}
                    {one.side === "HOST" ? `${one.partyName} (${one.organization})` : one.organization}
                    {one.state === "REFUSED"
                      ? <> · refused {fmtDate(one.answeredAt)} by {one.answeredBy}{one.answerNote ? <>: {one.answerNote}</> : null}</>
                      : <> · ended {fmtDate(one.endedAt)} by {one.endedBy}: {one.endReason}</>}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
    </Sheet>
  );
}
