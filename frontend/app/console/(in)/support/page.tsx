import Link from "next/link";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { consoleApi } from "@/lib/console/client";
import { answerSupportAction, setSupportContactAction } from "@/lib/console/forms";
import { cn, fmtDateTime } from "@/lib/core/utils";
import { Nothing, Plate, Sheet } from "../parts";

export const metadata = { title: "Support" };

type Grant = { id: string; tenantId: string; organization: string | null; grantedByName: string; why: string; from: string; until: string; endedAt: string | null; endedByName: string | null; open: boolean };
type Ask = {
  id: string; tenantId: string; organizationName: string; projectName: string | null; kind: string; subject: string; message: string;
  byName: string; byEmail: string; at: string; waiting: boolean;
  messages: { id: string; fromDelios: boolean; byName: string; text: string; at: string }[];
};

const KIND_WORDS: Record<string, string> = {
  SIGN_IN: "Signing in or account", OPEN_FILE: "A file does not open", UPLOAD: "A file is refused", ACCESS: "Cannot see or do something",
  ERROR: "An error", SETUP: "Setting up", BILLING: "Plan, invoice or payment", OTHER: "Something else",
};

/**
 * Support, in one place (owner: "it should be visible"): what people asked, answered here (they are told); how
 * organizations reach us, shown on Help, at the top of the organization's page and on the sign-in page; and the access
 * organizations granted us, for a set time, with why.
 */
export default async function Support() {
  const [asks, grants, platform] = await Promise.all([
    consoleApi<Ask[]>("/api/console/support/requests"), consoleApi<Grant[]>("/api/console/support"),
    consoleApi<Record<string, string>>("/api/console/platform"),
  ]);
  // Waiting: nothing answered yet, or the person wrote back since (owner: a conversation).
  const waiting = asks.filter((a) => a.waiting);
  const open = grants.filter((r) => r.open);
  return (
    <>
      <Plate
        title="Support"
        meta="What people asked, how they reach you, and the access organizations let you in with."
        figures={[
          { term: "Waiting for an answer", value: waiting.length, tone: waiting.length ? "text-amber-700" : undefined },
          { term: "Answered", value: asks.length - waiting.length },
          { term: "Access open now", value: open.length },
          { term: "Contact shown", value: platform.SUPPORT_EMAIL ? "Yes" : "Not yet", tone: platform.SUPPORT_EMAIL ? undefined : "text-amber-700", said: platform.SUPPORT_EMAIL ?? "fill it in below" },
        ]}
      />

      <Sheet title="Requests" said={waiting.length ? `${waiting.length} waiting` : "none waiting"}>
        {asks.length ? (
          <ul className="divide-y divide-line">
            {[...waiting, ...asks.filter((a) => !a.waiting)].map((a) => (
              <li key={a.id} className={cn("space-y-2 border-l-[3px] px-5 py-3 text-[13px] sm:px-6", a.waiting ? "border-l-amber-500" : "border-l-emerald-500")}>
                <div>
                  <p className="font-semibold text-slate-900">{a.subject}</p>
                  <p className="text-[11px] text-slate-500">
                    {KIND_WORDS[a.kind] ?? a.kind} · <Link href={`/console/organizations/${a.tenantId}`} className="text-link hover:underline">{a.organizationName}</Link>
                    {a.projectName ? ` · ${a.projectName}` : ""} · {a.byName} <a href={`mailto:${a.byEmail}`} className="text-link hover:underline">{a.byEmail}</a> · {fmtDateTime(a.at)}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-slate-700">{a.message}</p>
                </div>
                {a.messages.map((m) => (
                  <p key={m.id} className={cn("whitespace-pre-line border-l-[3px] pl-3", m.fromDelios ? "border-l-emerald-500 text-slate-800" : "border-l-line-strong text-slate-700")}>
                    <span className={cn("text-[11px] font-semibold", m.fromDelios ? "text-emerald-700" : "text-slate-500")}>{m.fromDelios ? `Answered by ${m.byName}` : `${a.byName} wrote back`} · {fmtDateTime(m.at)}</span><br />{m.text}
                  </p>
                ))}
                <ActionForm action={answerSupportAction} hidden={{ requestId: a.id }} submitLabel="Send the answer" size="sm" resetOnSuccess className="asking space-y-2">
                  <Field label={a.messages.length ? "Answer again" : "Your answer"} required={a.waiting} hint="they read it in their drawer and on Notifications"><textarea name="answer" required rows={a.waiting ? 3 : 2} className={inputCls} /></Field>
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : <Nothing>Nobody asked anything yet.</Nothing>}
      </Sheet>

      <Sheet title="How organizations reach you" said="shown on Help, at the top of the organization's page and on the sign-in page">
        <ActionForm action={setSupportContactAction} submitLabel="Save" className="asking grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 sm:px-6 md:grid-cols-3" footerClassName="md:col-span-3">
          <Field label="Email" hint="requests are sent here too"><input name="email" type="email" defaultValue={platform.SUPPORT_EMAIL ?? ""} className="plain w-full" /></Field>
          <Field label="Hours" hint="when someone answers"><input name="hours" defaultValue={platform.SUPPORT_HOURS ?? ""} className="plain w-full" /></Field>
          <Field label="Telephone" hint="optional"><input name="phone" defaultValue={platform.SUPPORT_PHONE ?? ""} className="plain w-full" /></Field>
        </ActionForm>
      </Sheet>

      <Sheet title="Access organizations let you in with" said="granted by one of their administrators, for a set time, with why">
        {grants.length ? (
          <ul className="divide-y divide-line">
            {grants.map((r) => (
              <li key={r.id} className={cn("px-5 py-3 text-[13px] sm:px-6", !r.open && "opacity-70")}>
                <Link href={`/console/organizations/${r.tenantId}`} className="font-medium text-slate-900 hover:text-link hover:underline">{r.organization ?? "An organization"}</Link>
                <span className={cn("ml-2 text-[11px] font-semibold", r.open ? "text-sky-700" : "text-slate-500")}>{r.open ? "open" : r.endedAt ? "ended early" : "over"}</span>
                <span className="block text-[12px] text-slate-600">
                  {r.grantedByName}, {fmtDateTime(r.from)} → {fmtDateTime(r.until)}{r.endedAt ? ` · ended ${fmtDateTime(r.endedAt)} by ${r.endedByName}` : ""} · {r.why}
                </span>
              </li>
            ))}
          </ul>
        ) : <Nothing>No organization let you in yet.</Nothing>}
      </Sheet>
    </>
  );
}
