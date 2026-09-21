import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { PageHeader, Chip, SeverityChip, ButtonLink, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { CHECK_BY_ID } from "@/lib/checks/catalog";
import { acceptDefectAction, closeDefectAction } from "@/lib/actions/conformance";
import { fmtDate, timeAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Defects" };

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-red-100 text-red-800 ring-red-300",
  ACCEPTED: "bg-amber-100 text-amber-800 ring-amber-300",
  CLOSED: "bg-emerald-100 text-emerald-800 ring-emerald-300",
};

export default async function DefectsPage({ searchParams }: { searchParams: Promise<{ severity?: string; status?: string; owner?: string }> }) {
  const { user, db } = await requireScope();
  const controller = isController(user) || isAdmin(user);
  const sp = await searchParams;
  const where = {
    AND: [
      sp.severity ? { severity: sp.severity } : {},
      sp.owner ? { ownerRole: sp.owner } : {},
      sp.status && sp.status !== "ALL" ? { status: sp.status } : sp.status === "ALL" ? {} : { status: { in: ["OPEN", "ACCEPTED"] } },
    ],
  };
  const defects = await db.defect.findMany({ where, orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }], take: 200 });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Defects"
        subtitle="Closed only when the check no longer finds it. Accepted defects still count."
        actions={<><a href="/api/export/defects" className="text-xs font-medium text-[#2d5480] hover:underline">Export ↓</a><ButtonLink href="/conformance" variant="secondary">← Conformance</ButtonLink></>}
      />

      <div className="flex flex-wrap gap-1.5">
        {["OPEN", "ACCEPTED", "CLOSED", "ALL"].map((s) => (
          <Link key={s} href={`/conformance/defects?status=${s}${sp.severity ? `&severity=${sp.severity}` : ""}${sp.owner ? `&owner=${sp.owner}` : ""}`}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${(sp.status ?? "OPEN") === s ? "bg-[#1e3a5f] text-white" : "bg-slate-100 text-slate-600"}`}>
            {s}
          </Link>
        ))}
        <span className="mx-2 w-px bg-slate-200" />
        {["CRITICAL", "MAJOR", "MINOR", "ADVISORY"].map((s) => (
          <Link key={s} href={`/conformance/defects?severity=${s}${sp.status ? `&status=${sp.status}` : ""}`}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${sp.severity === s ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}>
            {s}
          </Link>
        ))}
      </div>

      {defects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-400">No defects in this view.</p>
      ) : (
        <div className="space-y-3">
          {defects.map((d) => {
            const meta = CHECK_BY_ID.get(d.checkId);
            return (
              <article key={d.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityChip severity={d.severity} />
                  {d.status !== "OPEN" ? <Chip className={STATUS_STYLE[d.status] ?? ""}>{d.status.toLowerCase()}</Chip> : null}
                  <span className="min-w-0 flex-1 text-sm text-slate-800">{meta?.condition ?? d.description}</span>
                  <span className="text-[11px] text-slate-400">{d.ownerRole} · seen {timeAgo(d.lastSeenAt)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {d.entityType === "Document" && d.documentId
                    ? <Link href={`/documents/${d.documentId}`} className="font-mono font-semibold text-[#2d5480] hover:underline">{d.entityLabel ?? "open document"}</Link>
                    : d.entityLabel ? <span className="font-mono">{d.entityLabel}</span> : null}
                  <Link href={`/conformance/checks?family=${d.checkId.split("-")[0]}`} className="ml-2 font-mono text-slate-400 hover:underline">{d.checkId}</Link>
                </p>
                {d.status === "ACCEPTED" ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Accepted by {d.acceptedByName} — {d.acceptedReason} · review by {fmtDate(d.reviewDate)} · still counted
                  </p>
                ) : null}
                {controller && d.status === "OPEN" ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-[#315f83]">Resolve…</summary>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <ActionForm action={closeDefectAction} submitLabel="It is fixed — re-check" size="sm" variant="secondary" hidden={{ defectId: d.id }} />
                      <ActionForm action={acceptDefectAction} submitLabel="Accept it" size="sm" hidden={{ defectId: d.id }}>
                        <input name="reason" className={inputCls} placeholder="Why it is acceptable" />
                        <input type="date" name="reviewDate" className={inputCls} title="Review again on" />
                      </ActionForm>
                    </div>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
