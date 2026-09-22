import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { PageHeader, Card, Chip, Banner, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { EXPOSURES } from "@/lib/standard";
import { recordVoidReassessmentAction } from "@/lib/actions/revisions";
import { copyActionUpdateAction } from "@/lib/actions/transmittals";
import { sendCurrentRevisionAction, recordToldAction } from "@/lib/actions/supersession";
import { untoldRecipients } from "@/lib/supersession";
import { AssuranceTabs } from "@/app/(app)/conformance/tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Exposures" };

// §12.6 — five exposure conditions, each identifiable at any time, reported to
// the party responsible for ending it.
export default async function ExposuresPage() {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const controller = isController(user) || isAdmin(user);

  const [unpropagated, staleCopies, blocked, orphaned, unresolvedVoid] = await Promise.all([
    // Only revisions someone received and was never told about (§12.3).
    untoldRecipients(ctx),
    db.registeredCopy.findMany({
      where: { status: "ACTIVE", revision: { state: { in: ["SUPERSEDED", "VOID"] } } },
      include: { revision: { include: { document: true } } },
    }),
    db.revision.findMany({
      where: { state: "RELEASED", cycles: { some: { comments: { some: { progressionPreventing: true, status: "OPEN" } } } } },
      include: { document: true, cycles: { include: { comments: { where: { progressionPreventing: true, status: "OPEN" } } } } },
    }),
    db.baselineEntry.findMany({ where: { document: { state: "WITHDRAWN" } }, include: { document: true, action: true } }),
    db.revision.findMany({ where: { state: "VOID", voidReassessment: null }, include: { document: true } }),
  ]);

  const total = unpropagated.length + staleCopies.length + blocked.length + orphaned.length + unresolvedVoid.length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Out-of-date risks"
        subtitle="Replaced or withdrawn information that may still be in use, and who must act."
        actions={<Chip className={total > 0 ? "bg-amber-100 text-amber-800 ring-amber-300" : "bg-emerald-100 text-emerald-800 ring-emerald-300"}>{total} open</Chip>}
      />
      <AssuranceTabs current="/exposures" />

      {total === 0 ? <Banner tone="good" title="No exposures">No unpropagated supersessions, uncontrolled copies, blocked work, orphaned withdrawals or unresolved voids.</Banner> : null}

      {/* 1 — Unpropagated supersession */}
      <Card title={`${EXPOSURES[0].label} (${unpropagated.length})`} description={`${EXPOSURES[0].detail} · ${EXPOSURES[0].who} acts`}>
        {unpropagated.length === 0 ? <p className="text-xs text-emerald-700">✓ Everyone who received a replaced revision has been told.</p> : (
          <ul className="divide-y divide-slate-100">
            {unpropagated.map((u) => (
              <li key={u.old.id} className="py-3">
                <p className="text-sm">
                  <Link href={`/documents/${u.document.id}`} className="font-mono font-semibold text-[#1e3a5f] hover:underline">{u.document.docNumber}</Link>
                  <span className="ml-1.5 text-xs text-slate-600">rev {u.old.value} was replaced{u.current ? ` by rev ${u.current.value}` : ""}</span>
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Still holding rev {u.old.value}: {u.recipients.map((r, n) => (
                    <span key={r.key}>{n ? ", " : ""}<span className="font-medium text-slate-800">{r.name}</span>{r.organization ? ` (${r.organization})` : ""}<span className="text-slate-400"> · got it on {r.via}</span></span>
                  ))}
                </p>
                {controller ? (
                  <div className="mt-2 flex flex-wrap items-start gap-3">
                    {u.draft ? (
                      <Link href={`/transmittals/${u.draft.id}`} className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-200">{u.draft.number} is ready — issue it →</Link>
                    ) : u.current ? (
                      <ActionForm action={sendCurrentRevisionAction} submitLabel={`Send rev ${u.current.value} to them`} size="sm" hidden={{ revisionId: u.old.id }} className="space-y-0" />
                    ) : <span className="text-xs text-amber-700">No released revision to send yet.</span>}
                    <details className="text-xs">
                      <summary className="cursor-pointer py-1.5 font-semibold text-[#315f83]">They were told another way</summary>
                      <div className="mt-2 w-80">
                        <ActionForm action={recordToldAction} submitLabel="Record" size="sm" hidden={{ revisionId: u.old.id }}>
                          <input name="note" required className={inputCls} placeholder="How — e.g. site meeting 22 Sept, minutes MIN-014" />
                        </ActionForm>
                      </div>
                    </details>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 2 — Uncontrolled current use */}
      <Card title={`${EXPOSURES[1].label} (${staleCopies.length})`} description={`${EXPOSURES[1].detail} · ${EXPOSURES[1].who} acts`}>
        {staleCopies.length === 0 ? <p className="text-xs text-emerald-700">✓ None.</p> : (
          <ul className="divide-y divide-slate-100">
            {staleCopies.map((c) => (
              <li key={c.id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">
                    <Link href={`/documents/${c.revision.documentId}`} className="font-mono font-semibold text-[#1e3a5f] hover:underline">{c.revision.document.docNumber}</Link>
                    <span className="ml-1.5 font-mono text-xs">rev {c.revision.value}</span>
                    <span className="text-slate-400"> · copy with {c.holder} at {c.location}</span>
                  </span>
                  <span className="text-xs text-slate-400">registered copy carries an invalid revision</span>
                </div>
                {controller ? (
                  <div className="mt-2 max-w-md">
                    <ActionForm action={copyActionUpdateAction} submitLabel="Record copy action" size="sm" hidden={{ copyId: c.id }}>
                      <div className="flex items-end gap-2">
                        <select name="copyAction" className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs" defaultValue="RECALLED">
                          <option value="RECALLED">Recalled</option>
                          <option value="REPLACED">Replaced</option>
                          <option value="MARKED_OBSOLETE">Marked obsolete at its location</option>
                        </select>
                        <input name="actionRecord" className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs" placeholder="Action taken" />
                      </div>
                    </ActionForm>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 3 — Blocked work */}
      <Card title={`${EXPOSURES[2].label} (${blocked.length})`} description={`${EXPOSURES[2].detail} · ${EXPOSURES[2].who} acts`}>
        {blocked.length === 0 ? <p className="text-xs text-emerald-700">✓ None.</p> : (
          <ul className="divide-y divide-slate-100">
            {blocked.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm">
                  <Link href={`/documents/${r.documentId}`} className="font-mono font-semibold text-[#1e3a5f] hover:underline">{r.document.docNumber}</Link>
                  <span className="ml-1.5 font-mono text-xs">rev {r.value}</span>
                  <span className="block text-xs text-slate-400">{r.cycles.reduce((a, c) => a + c.comments.length, 0)} blocking comment(s) open — do not work from it</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 4 — Orphaned withdrawal */}
      <Card title={`${EXPOSURES[3].label} (${orphaned.length})`} description={`${EXPOSURES[3].detail} · ${EXPOSURES[3].who} acts`}>
        {orphaned.length === 0 ? <p className="text-xs text-emerald-700">✓ None.</p> : (
          <ul className="divide-y divide-slate-100">
            {orphaned.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm">
                  <Link href={`/documents/${e.documentId}`} className="font-mono font-semibold text-[#1e3a5f] hover:underline">{e.document.docNumber}</Link>
                  <span className="block text-xs text-slate-400">action {e.action.code} — {e.action.name} still requires it</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 5 — Unresolved void */}
      <Card title={`${EXPOSURES[4].label} (${unresolvedVoid.length})`} description={`${EXPOSURES[4].detail} · ${EXPOSURES[4].who} acts`}>
        {unresolvedVoid.length === 0 ? <p className="text-xs text-emerald-700">✓ None.</p> : (
          <ul className="divide-y divide-slate-100">
            {unresolvedVoid.map((r) => (
              <li key={r.id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">
                    <Link href={`/documents/${r.documentId}`} className="font-mono font-semibold text-[#1e3a5f] hover:underline">{r.document.docNumber}</Link>
                    <span className="ml-1.5 font-mono text-xs">rev {r.value}</span>
                    <span className="text-slate-400"> · voided “{r.voidReason ?? ""}”</span>
                  </span>
                </div>
                {controller ? (
                  <div className="mt-2 max-w-lg">
                    <ActionForm action={recordVoidReassessmentAction} submitLabel="Record reassessment" size="sm" hidden={{ revisionId: r.id }}>
                      <input name="note" className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" placeholder="What was built from it, and the outcome of the reassessment" />
                    </ActionForm>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
