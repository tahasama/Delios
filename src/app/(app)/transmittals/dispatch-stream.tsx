import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Paperclip } from "lucide-react";

/**
 * A log read as correspondence: filed by the day it moved, one slip per entry,
 * the route drawn rather than tabulated.
 *
 * Kept, unused, for the history of a document — where a stream of events in the
 * order they happened is the right shape and a table is not. The transmittals
 * list itself is a register and reads as one.
 */
export type Slip = {
  id: string;
  href: string;
  number: string;
  subject: string | null;
  outgoing: boolean;
  draft: boolean;
  from: string;
  to: string;
  attachments: number;
  reason: string;
  mark: { className: string; word: string };
  recipients: { id: string; name: string; seen: boolean }[];
  due: { text: string; className: string } | null;
};

const day = (date: Date) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" }).format(date);
const weekday = (date: Date) => new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(date);

export function DispatchStream({ days }: { days: { key: number; date: Date; slips: Slip[] }[] }) {
  return (
    <div className="dispatch space-y-6">
      {days.map((entry) => (
        <section key={entry.key}>
          <div className="day-rule mb-2.5">
            <span className="font-mono text-[11px] tabular-nums tracking-wide">{day(entry.date)}</span>
            <span className="day-name">{weekday(entry.date)}</span>
          </div>

          <div className="space-y-2">
            {entry.slips.map((slip) => {
              const Arrow = slip.outgoing ? ArrowUpRight : ArrowDownLeft;
              const seen = slip.recipients.filter((person) => person.seen).length;
              return (
                <Link key={slip.id} href={slip.href} className={`slip ${slip.draft ? "slip-draft" : slip.outgoing ? "slip-out" : "slip-in"}`}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="slip-number inline-flex items-baseline gap-1.5">
                      <Arrow className="h-3.5 w-3.5 self-center" aria-hidden />
                      {slip.number}
                    </span>
                    <span className={`postmark ${slip.mark.className}`}>{slip.mark.word}</span>
                    {slip.due ? <span className={`ml-auto text-[11px] ${slip.due.className}`}>Reply {slip.due.text}</span> : null}
                  </div>

                  {slip.subject ? <p className="slip-subject mt-1.5">{slip.subject}</p> : null}

                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5">
                    <span className="route min-w-0">
                      <span className="route-party truncate">{slip.from}</span>
                      <span className="route-line" aria-hidden />
                      <span className="route-party truncate">{slip.to}</span>
                    </span>

                    <span className="slip-note inline-flex items-center gap-1.5">
                      <Paperclip className="h-3.5 w-3.5 opacity-60" aria-hidden />
                      <span className="font-mono tabular-nums">{slip.attachments}</span>
                      {slip.attachments === 1 ? "document" : "documents"}
                    </span>

                    <span className="slip-note">{slip.reason}</span>

                    {slip.recipients.length ? (
                      <span className="slip-note ml-auto inline-flex items-center gap-1.5">
                        <span className="flex items-center gap-1">
                          {slip.recipients.slice(0, 8).map((person) => <span key={person.id} className={`dot ${person.seen ? "dot-on" : ""}`} />)}
                        </span>
                        {seen === slip.recipients.length ? "all seen" : `${seen} of ${slip.recipients.length} seen`}
                      </span>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
