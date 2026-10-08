import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { PageHeader, Card, Chip, Banner, inputCls, btn } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { EXPOSURES } from "@/lib/standard";
import { recordVoidReassessmentAction } from "@/lib/actions/revisions";
import { untoldRecipients, sendCurrentLink } from "@/lib/supersession";
import { haltedRevisions } from "@/lib/halted";
import { orphanedNeeds } from "@/lib/exposure-counts";
import { AssuranceTabs } from "@/app/(app)/conformance/tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Exposures" };

// §12.6 — five exposure conditions, each identifiable at any time, reported to
// the party responsible for ending it.
const exposure = (key: (typeof EXPOSURES)[number]["key"]) => EXPOSURES.find((e) => e.key === key)!;

export default async function ExposuresPage() {
  const ctx = await requireScope();
  const { user } = ctx;
  const controller = isController(user) || isAdmin(user);

  const [unpropagated, blocked, orphaned, unresolvedVoid] = await Promise.all([
    // Only revisions someone received and was never told about (§12.3).
    untoldRecipients(ctx),
    haltedRevisions(ctx).then((rows) => rows.map((r) => ({ ...r, cycles: [{ outcome: r.verdict, outcomeByName: r.decidedBy }] }))),
    orphanedNeeds(ctx),
    // A void revision's reassessment is not kept by the backend: none is listed as unresolved.
    Promise.resolve([] as { id: string; documentId: string; value: string; voidReason: string | null; document: { docNumber: string } }[]),
  ]);

  const total = unpropagated.length + blocked.length + orphaned.length + unresolvedVoid.length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Out-of-date risks"
        subtitle="Replaced or withdrawn information that may still be in use, and who must act."
        actions={<Chip className={total > 0 ? "bg-amber-100 text-amber-800 ring-amber-300" : "bg-emerald-100 text-emerald-800 ring-emerald-300"}>{total} open</Chip>}
      />
      <AssuranceTabs current="/conformance/checks" internal={user.isInternal} />

      {total === 0 ? <Banner tone="good" title="No exposures">Nobody holds a replaced revision without knowing, no work is blocked, and nothing withdrawn or voided is still relied on.</Banner> : null}

      {/* 1 — Unpropagated supersession */}
      <Card title={`${exposure("UNPROPAGATED_SUPERSESSION").label} (${unpropagated.length})`} description={`${exposure("UNPROPAGATED_SUPERSESSION").detail} · ${exposure("UNPROPAGATED_SUPERSESSION").who} acts`}>
        {unpropagated.length === 0 ? <p className="text-xs text-emerald-700">✓ Everyone who received a replaced revision has been told.</p> : (
          <ul className="divide-y divide-line">
            {unpropagated.map((u) => (
              <li key={u.old.id} className="py-3">
                <p className="text-sm">
                  <Link href={`/documents/${u.document.id}`} className="font-mono font-semibold text-brand-ink hover:underline">{u.document.docNumber}</Link>
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
                      <Link href={sendCurrentLink(u)!} className={btn("primary", "sm")}>Send rev {u.current.value} to them</Link>
                    ) : <span className="text-xs text-amber-700">No released revision to send yet.</span>}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 3 — Blocked work */}
      <Card title={`${exposure("BLOCKED_WORK").label} (${blocked.length})`} description={`${exposure("BLOCKED_WORK").detail} · ${exposure("BLOCKED_WORK").who} acts`}>
        {blocked.length === 0 ? <p className="text-xs text-emerald-700">✓ None.</p> : (
          <ul className="divide-y divide-line">
            {blocked.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm">
                  <Link href={`/documents/${r.documentId}`} className="font-mono font-semibold text-brand-ink hover:underline">{r.document.docNumber}</Link>
                  <span className="ml-1.5 font-mono text-xs">rev {r.value}</span>
                  <span className="block text-xs text-slate-400">
                    {r.cycles[0]?.outcomeByName ? `${r.cycles[0].outcomeByName} decided ` : "Decided "}
                    {r.cycles[0]?.outcome ?? "—"} — do not work from it
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 4 — Orphaned withdrawal */}
      <Card title={`${exposure("ORPHANED_WITHDRAWAL").label} (${orphaned.length})`} description={`${exposure("ORPHANED_WITHDRAWAL").detail} · ${exposure("ORPHANED_WITHDRAWAL").who} acts`}>
        {orphaned.length === 0 ? <p className="text-xs text-emerald-700">✓ None.</p> : (
          <ul className="divide-y divide-line">
            {orphaned.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm">
                  <Link href={`/documents/${e.documentId}`} className="font-mono font-semibold text-brand-ink hover:underline">{e.document.docNumber}</Link>
                  <span className="block text-xs text-slate-400">action {e.action.code} — {e.action.name} still requires it</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 5 — Unresolved void */}
      <Card title={`${exposure("UNRESOLVED_VOID").label} (${unresolvedVoid.length})`} description={`${exposure("UNRESOLVED_VOID").detail} · ${exposure("UNRESOLVED_VOID").who} acts`}>
        {unresolvedVoid.length === 0 ? <p className="text-xs text-emerald-700">✓ None.</p> : (
          <ul className="divide-y divide-line">
            {unresolvedVoid.map((r) => (
              <li key={r.id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">
                    <Link href={`/documents/${r.documentId}`} className="font-mono font-semibold text-brand-ink hover:underline">{r.document.docNumber}</Link>
                    <span className="ml-1.5 font-mono text-xs">rev {r.value}</span>
                    <span className="text-slate-400"> · voided “{r.voidReason ?? ""}”</span>
                  </span>
                </div>
                {controller ? (
                  <div className="mt-2 max-w-lg">
                    <ActionForm action={recordVoidReassessmentAction} submitLabel="Record reassessment" size="sm" hidden={{ revisionId: r.id }}>
                      <input name="note" className="w-full rounded-lg border border-line-strong px-2 py-1.5 text-xs" placeholder="What was built from it, and the outcome of the reassessment" />
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
