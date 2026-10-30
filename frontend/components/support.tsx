import { Mail, Phone, Clock } from "lucide-react";
import { SupportPanel } from "@/components/support-panel";
import { ActionForm } from "@/components/form";
import { Field, inputCls } from "@/components/ui";
import { Select } from "@/components/select";
import { api } from "@/lib/client";
import { askSupportAction, replySupportAction } from "@/lib/support/forms";
import { fmtDateTime } from "@/lib/core/utils";

export type SupportContact = { email: string | null; hours: string | null; phone: string | null };
type Mine = {
  kinds: { code: string; label: string }[];
  mine: {
    id: string; kind: string; subject: string; message: string; projectName: string | null; at: string; waiting: boolean;
    messages: { id: string; fromDelios: boolean; byName: string; text: string; at: string }[];
  }[];
};

export const supportContact = () =>
  api<SupportContact>("/api/legal/support-contact").catch((): SupportContact => ({ email: null, hours: null, phone: null }));

/** How to reach DELIOS support, on one line, where it is set (console → Support). */
export function SupportLine({ contact }: { contact: SupportContact }) {
  if (!contact.email && !contact.phone && !contact.hours) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600">
      <span className="font-semibold text-slate-700">DELIOS support</span>
      {contact.email ? <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1 text-link hover:underline"><Mail className="h-3.5 w-3.5" />{contact.email}</a> : null}
      {contact.phone ? <a href={`tel:${contact.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-link hover:underline"><Phone className="h-3.5 w-3.5" />{contact.phone}</a> : null}
      {contact.hours ? <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{contact.hours}</span> : null}
    </p>
  );
}

/**
 * The drawer (owner: "just have them write a message with object, we already know which org and which project, and have
 * a drawer with main type of requests"): what it is about, a subject, a message; then what was asked before and its answer.
 */
export async function Support({ projectId, contact, startOpen }: { projectId?: string; contact: SupportContact; startOpen?: boolean }) {
  const { kinds, mine } = await api<Mine>("/api/support/requests").catch((): Mine => ({ kinds: [], mine: [] }));
  const kindOf = new Map(kinds.map((k) => [k.code, k.label]));
  return (
    <SupportPanel startOpen={startOpen}>
        <div className="border-b border-line px-5 pt-6 pb-4 pr-14 sm:px-6 sm:pr-14">
          <div className="min-w-0 space-y-2">
            <h2 className="plate-title text-slate-950">Need support</h2>
            <p className="plate-meta">Write to the DELIOS team. They know who you are, your organization and your project.</p>
            <SupportLine contact={contact} />
          </div>
        </div>
        <ActionForm action={askSupportAction} submitLabel="Send to support" resetOnSuccess hidden={projectId ? { projectId } : undefined}
          className="asking space-y-4 border-b border-line px-5 py-5 sm:px-6">
          <Field label="What is it about" required>
            <Select name="kind" required defaultValue="" className="plain w-full">
              <option value="" disabled>Choose</option>
              {kinds.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
            </Select>
          </Field>
          <Field label="Subject" required><input name="subject" required maxLength={200} className="plain w-full" /></Field>
          <Field label="Message" required hint="what you did, what you expected, what happened">
            <textarea name="message" required rows={6} maxLength={4000} className={inputCls} />
          </Field>
        </ActionForm>
        <div className="px-5 py-4 sm:px-6">
          <p className="stencil mb-2 text-slate-500">What you asked</p>
          {mine.length ? (
            <ul className="space-y-3">
              {mine.map((r) => (
                <li key={r.id} className="rounded-md p-3 text-[13px] ring-1 ring-line">
                  <p className="font-semibold text-slate-900">{r.subject}</p>
                  <p className="text-[11px] text-slate-500">{kindOf.get(r.kind) ?? r.kind} · {fmtDateTime(r.at)}{r.projectName ? ` · ${r.projectName}` : ""}</p>
                  <p className="mt-1 whitespace-pre-line text-slate-700">{r.message}</p>
                  {/* The conversation (owner: back and forth), oldest first: DELIOS support's answers marked green. */}
                  {r.messages.map((m) => (
                    <div key={m.id} className={`mt-2 border-l-[3px] pl-3 ${m.fromDelios ? "border-l-emerald-500" : "border-l-line-strong"}`}>
                      <p className={`text-[11px] font-semibold ${m.fromDelios ? "text-emerald-700" : "text-slate-500"}`}>{m.fromDelios ? `DELIOS support · ${m.byName}` : "You"} · {fmtDateTime(m.at)}</p>
                      <p className="whitespace-pre-line text-slate-800">{m.text}</p>
                    </div>
                  ))}
                  {r.waiting ? <p className="mt-2 text-[12px] font-semibold text-amber-700">Waiting for support</p> : null}
                  <details className="mt-2">
                    <summary className="ask cursor-pointer list-none">Write back</summary>
                    <ActionForm action={replySupportAction} hidden={{ requestId: r.id }} submitLabel="Send" size="sm" resetOnSuccess className="asking mt-2 space-y-2">
                      <Field label="Your message" required><textarea name="text" required rows={3} maxLength={4000} className={inputCls} /></Field>
                    </ActionForm>
                  </details>
                </li>
              ))}
            </ul>
          ) : <p className="text-[13px] text-slate-500">Nothing asked yet.</p>}
        </div>
    </SupportPanel>
  );
}
