import { LifeBuoy } from "lucide-react";

/** One thing that goes wrong: what people see, why it happens, what to try. */
type Trouble = { id: string; seen: string; why: string[]; tries: string[] };

/**
 * When something goes wrong (owner: "help messages for any case, like 'we can't open a document'"): the cases people
 * meet, each with why it happens and what to try, and support's contact with the case already written in the email.
 */
export const TROUBLES: Trouble[] = [
  {
    id: "open", seen: "A document does not open, or its Preview stays empty",
    why: [
      "Every file is checked for viruses as it arrives: about a minute. Until then the Preview says it is being checked, and reads itself again.",
      "A file locked by a password, or holding more than the check can open, is refused: its Preview says so in red.",
      "The reader for that kind of file may be switched off (Settings → Viewing files): the file is then offered to download.",
      "A document above your function's clearance is read only by the people named on it, its registrar and those it was sent to.",
      "Another organization reads only the revisions sent to it on a transmittal.",
    ],
    tries: ["Wait a minute and open it again.", "If it was refused, send the file again without its password.", "Ask the control function whether you may read it."],
  },
  {
    id: "upload", seen: "A file is refused when I upload it",
    why: [
      "The box decides what a file is: the PDF box takes a PDF, the source file box the editable original. The message names the right box.",
      "A file locked by a password, or with a virus, is refused.",
      "A revision that is no longer being prepared takes no new file: start a new revision.",
    ],
    tries: ["Put it in the box the message names.", "Remove its password and send it again.", "Open Edit rev on a revision being prepared."],
  },
  {
    id: "sign-in", seen: "I cannot sign in",
    why: [
      "Five wrong tries lock the account for a few minutes.",
      "The two-step code changes every 30 seconds; a phone whose clock is wrong gives wrong codes.",
      "A new account waits for its email link to be opened.",
      "An administrator may have switched your account off, or your organization may have been switched off.",
    ],
    tries: ["Use “Forgot password” on the sign-in page.", "Set your phone's clock to automatic; or type one of your recovery codes.", "Ask your administrator."],
  },
  {
    id: "review", seen: "A review does not move on",
    why: [
      "Its page says whom it waits on, step by step.",
      "Where the control function sends reviews on, it waits for them first (Home: “Send to reviewers”).",
      "Someone away can hand their step over (Delegate on the answer card).",
    ],
    tries: ["Open the review: Notify reminds whoever it waits on.", "Ask the control function to delegate the step."],
  },
  {
    id: "email", seen: "I did not get an email",
    why: [
      "Everything sent by email is also on Notifications and Home.",
      "It may be in your spam folder; or your organization may have email switched off.",
    ],
    tries: ["Look on Notifications.", "Add the sender to your contacts, then ask for it again.", "Ask your administrator whether email is on."],
  },
  {
    id: "cannot", seen: "A button is missing, or a field cannot be changed",
    why: [
      "What you may do comes from your function on the project (Settings → Functions & permissions, read by everyone of ours).",
      "A document's details change only while a revision is being prepared; after that, a new revision.",
      "The organization may keep a setting the same on every project.",
      "An organization reading only (not paid) changes nothing until it is put right; everyone still reads and exports.",
    ],
    tries: ["Read what your function may do in Functions & permissions.", "Start a new revision to change a released document.", "Ask the control function."],
  },
  {
    id: "value", seen: "A value I need is not in a list",
    why: ["Each list offers only the values of the set serving the document's deliverable type (Settings → Types & sets)."],
    tries: ["Ask the control function to add it, or to add your deliverable type to its set."],
  },
];

/** The cases, each folded, with support's contact; the email names the case and where it happened. */
export function TroubleList({ contact, where }: { contact: { email: string | null; hours: string | null; phone: string | null }; where: string }) {
  const mail = (seen: string) =>
    contact.email
      ? `mailto:${contact.email}?subject=${encodeURIComponent(`DELIOS: ${seen}`)}&body=${encodeURIComponent(`What happened:\n\nWhat I tried:\n\n${where}\n`)}`
      : null;
  return (
    <div>
      <ul className="divide-y divide-line">
        {TROUBLES.map((t) => (
          <li key={t.id} id={`trouble-${t.id}`} className="scroll-mt-24">
            <details className="group">
              <summary className="cursor-pointer list-none px-5 py-3 text-[13px] font-semibold text-slate-900 hover:bg-tint-soft group-open:bg-tint-soft sm:px-6">{t.seen}</summary>
              <div className="grid gap-4 px-5 pt-1 pb-4 sm:px-6 md:grid-cols-2">
                <div>
                  <p className="stencil mb-1 text-slate-500">Why it happens</p>
                  <ul className="list-disc space-y-1 pl-4 text-[12px] leading-5 text-slate-700">{t.why.map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
                <div>
                  <p className="stencil mb-1 text-slate-500">What to try</p>
                  <ol className="list-decimal space-y-1 pl-4 text-[12px] leading-5 text-slate-700">{t.tries.map((w) => <li key={w}>{w}</li>)}</ol>
                  {mail(t.seen) ? (
                    <a href={mail(t.seen)!} className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-link hover:underline">
                      <LifeBuoy className="h-3.5 w-3.5" /> Still stuck? Write to DELIOS support
                    </a>
                  ) : null}
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-5 py-3 text-[12px] text-slate-600 sm:px-6">
        DELIOS support: {contact.email ? <a href={`mailto:${contact.email}`} className="font-semibold text-link hover:underline">{contact.email}</a> : "ask your administrator how to reach it"}
        {contact.phone ? ` · ${contact.phone}` : ""}{contact.hours ? ` · ${contact.hours}` : ""}. Your administrator may let support in to see for themselves (Contract &amp; plan).
      </p>
    </div>
  );
}
