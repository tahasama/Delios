import { requireScope } from "@/lib/scope";
import { ActionForm } from "@/components/form";
import { attachSupplierFileAction, sendSupplierDocumentsAction } from "@/lib/actions/supplier";
import { NextStepBody, StagePath, type StepItem } from "./next-step";
import { cn } from "@/lib/utils";

/**
 * What a supplier sees on a document it owes us: attach the file, then send it.
 * The Send button exists only once a file is attached. After that it is with
 * us — checked by Document Control, then reviewed.
 */
export async function SupplierDelivery({ documentId }: { documentId: string }) {
  const { db } = await requireScope();
  const org = (await db.scopeConfig.findFirst())?.organizationName ?? "us";
  const latest = await db.revision.findFirst({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    include: { transmittalItems: { include: { transmittal: { select: { status: true, rejectionReason: true, number: true, direction: true } } } } },
  });
  const incoming = latest?.transmittalItems.map((i) => i.transmittal).filter((t) => t.direction === "INCOMING") ?? [];
  const rejected = incoming.find((t) => t.status === "REJECTED") ?? null;
  const hasFile = !!(latest?.renditionFileId || latest?.nativeFileId);
  const preparing = !latest || latest.state === "IN_PREPARATION";
  const waitingToSend = preparing && hasFile && (!latest?.submittedAt || !!rejected);
  const toAttach = preparing && (!hasFile || !!rejected || !latest?.submittedAt);

  const at = !latest || (preparing && !hasFile) ? 0
    : waitingToSend ? 1
    : preparing ? 2
    : latest.state === "IN_REVIEW" || latest.state === "NOT_RELEASED" ? 3
    : 4;
  const note = rejected && waitingToSend ? <>{org} turned it back{rejected.rejectionReason ? <>: <em>{rejected.rejectionReason}</em></> : null}. Attach the corrected file and send it again.</>
    : at === 0 ? <>Attach your file. It goes in under this number; your own number can stay inside the document.</>
    : at === 1 ? <>Rev {latest!.value} has its file. Send it when you are ready.</>
    : at === 2 ? <>Sent. {org} checks it, then accepts it for review or turns it back with a reason.</>
    : at === 3 ? <>With {org}: under review.</>
    : <>Reviewed and in use.</>;

  const items: StepItem[] = [];
  if (waitingToSend && latest) items.push({
    key: "send",
    primary: true,
    label: `Send to ${org}`,
    body: (
      <ActionForm action={sendSupplierDocumentsAction} submitLabel={`Send rev ${latest.value}`} size="sm" hidden={{ revisionId: latest.id }}>
        <p className="text-xs text-slate-500">One transmittal carries it to {org}&apos;s Document Control.</p>
      </ActionForm>
    ),
  });
  if (toAttach) items.push({
    key: "attach",
    primary: !waitingToSend,
    open: at === 0,
    label: hasFile ? "Replace the file" : "Attach your file",
    body: (
      <ActionForm action={attachSupplierFileAction} submitLabel="Attach" size="sm" hidden={{ documentId }}>
        <input type="file" name="file" required className="block w-full text-xs" />
        <p className="text-[11px] text-slate-500">A PDF is what people read; send the editable original as well if it was asked for.</p>
      </ActionForm>
    ),
  });

  return (
    <section className={cn("register register-sheet register-sheet-open relative", at >= 2 ? "rail-review" : "rail-prep")}>
      <span className="absolute inset-y-0 left-0 w-0.75 rounded-l-[0.875rem] bg-(--rail)" aria-hidden />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil text-slate-600">Your delivery</span>
        <span className="text-[11px] text-slate-500">asked of you by {org}</span>
      </div>
      <NextStepBody items={items} status={<StagePath stages={["Attach", "Send", "Checked", "Reviewed"]} at={at} note={note} />} />
    </section>
  );
}
