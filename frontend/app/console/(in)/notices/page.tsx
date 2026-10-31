import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { consoleApi } from "@/lib/console/client";
import { sendNoticeAction } from "@/lib/console/forms";
import type { OperatorEvent } from "@/lib/console/types";
import { fmtDateTime } from "@/lib/core/utils";
import { Nothing, Plate, Sheet } from "../parts";

export const metadata = { title: "Notices" };

/** A word to every organization's administrators (maintenance, an incident, a new subprocessor), by notification and email. */
export default async function Notices() {
  const sent = await consoleApi<OperatorEvent[]>("/api/console/notices");
  return (
    <>
      <Plate title="Notices" meta="Told to every active organization's administrators, on their Notifications and by email. A new subprocessor is announced here before it starts." />
      <div className="grid gap-4 lg:grid-cols-[24rem_minmax(0,1fr)]">
        <Sheet title="Tell every administrator">
          <ActionForm action={sendNoticeAction} submitLabel="Send" resetOnSuccess confirmText="Every active organization's administrators are told now." className="asking space-y-4 px-5 py-4 sm:px-6">
            <Field label="About" required><input name="title" required maxLength={200} className="plain w-full" placeholder="Maintenance on Sunday 2 November, 06:00–07:00 UTC" /></Field>
            <Field label="What it says" required><textarea name="body" required rows={6} maxLength={2000} className={inputCls} /></Field>
          </ActionForm>
        </Sheet>
        <Sheet title="Sent" said="newest first">
          {sent.length ? (
            <ul className="divide-y divide-line">
              {sent.map((e) => <li key={e.id} className="px-5 py-3 text-[13px] sm:px-6"><span className="text-[11px] text-slate-500">{fmtDateTime(e.at)} · {e.operatorName}</span><span className="block whitespace-pre-line text-slate-700">{e.detail}</span></li>)}
            </ul>
          ) : <Nothing>Nothing sent yet.</Nothing>}
        </Sheet>
      </div>
    </>
  );
}
