import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { PageHeader, Card, Chip, SeverityChip, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { closeDefectAction, acceptDefectAction } from "@/lib/actions/conformance";
import { findingsOfType, todoOf, OWNER_LABEL } from "@/lib/problems";
import { PHASE_LABEL, CHECK_BY_ID } from "@/lib/checks/catalog";
import { ArrowRight, ArrowLeft } from "lucide-react";

/** One kind of problem, and every document carrying it. */
export async function OneKind({
  ctx,
  checkId,
  controller,
  back,
}: {
  ctx: Awaited<ReturnType<typeof requireScope>>;
  checkId: string;
  controller: boolean;
  /** Where "all problems" goes — the list this was opened from. */
  back: string;
}) {
  const meta = CHECK_BY_ID.get(checkId)!;
  const rows = await findingsOfType(ctx, checkId);
  const documents = new Set(rows.filter((r) => r.document).map((r) => r.document!.id)).size;
  const counted = documents
    ? `${documents} document${documents === 1 ? "" : "s"}`
    : `${rows.length} finding${rows.length === 1 ? "" : "s"}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title={meta.condition}
        eyebrow={`${PHASE_LABEL[meta.phase]} · ${counted}`}
        subtitle={todoOf(checkId)}
        actions={<Link href={back} className="inline-flex items-center gap-1.5 text-xs font-semibold text-link hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> Back to the checks</Link>}
      />

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <SeverityChip severity={meta.severity} />
        <span>{OWNER_LABEL[meta.owner] ?? meta.owner}&rsquo;s to fix</span>
        <span className="font-mono text-slate-400">{checkId}</span>
        <span className="ml-auto max-w-prose text-right text-[11px] text-slate-400">{meta.method}. Read from: {meta.evidence.toLowerCase()}.</span>
      </div>

      <Card title="Where it is">
        <ul className="divide-y divide-line">
          {rows.map((one) => (
            <li key={one.id} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {one.document ? (
                  <Link href={`/documents/${one.document.id}`} className="font-mono text-[13px] font-semibold text-brand-ink hover:underline">{one.document.docNumber}</Link>
                ) : (
                  <span className="font-mono text-[13px] text-slate-500">{one.label ?? "across the project"}</span>
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] text-slate-600">{one.document?.title ?? one.text}</span>
                {one.status === "ACCEPTED" ? <Chip className="bg-amber-100 text-amber-900 ring-amber-300">accepted, still counted</Chip> : null}
                <Link href={one.fix.href} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-link transition hover:bg-tint">
                  {one.fix.label} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              {controller && one.status === "OPEN" ? (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[11px] font-semibold text-slate-400 hover:text-slate-700">Fixed it, or accept it as it is…</summary>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <ActionForm action={closeDefectAction} submitLabel="I fixed it — check again" size="sm" variant="secondary" hidden={{ defectId: one.id }} />
                    <ActionForm action={acceptDefectAction} submitLabel="Accept it" size="sm" hidden={{ defectId: one.id }}>
                      <input name="reason" className={inputCls} placeholder="Why it is acceptable" />
                      <input type="date" name="reviewDate" className={inputCls} title="Look at it again on" />
                    </ActionForm>
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
