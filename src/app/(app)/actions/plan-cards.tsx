import Link from "next/link";
import { requireScope } from "@/lib/scope";
import { scheduleSource } from "@/lib/api/schedule";
import { backendDocument } from "@/lib/api/legacy";

/**
 * Where the schedule comes from, and the two pages behind it, on one quiet line.
 *
 * The dates are read from the released schedule document on their own, so most
 * days there is nothing to do here. Uploading a list by hand is the exception —
 * for whoever plans the project — and is offered to them alone, last.
 */
const BY_HAND = [
  { kind: "SCHEDULE", noun: "schedule" },
  { kind: "ACTION_DEPARTMENTS", noun: "disciplines per action" },
  { kind: "DOCUMENT_REQUIREMENTS", noun: "requirements" },
];

export async function PlanCards() {
  const ctx = await requireScope();
  const plans = ctx.can("PLAN") || ctx.can("CONTROL") || ctx.can("CONFIGURE");
  const { source } = await scheduleSource(ctx);
  const document = source ? await backendDocument(ctx, source.documentId).catch(() => null) : null;

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-500">
      {document ? (
        <span>
          Dates from <Link href={`/documents/${document.id}`} className="font-mono font-semibold text-link hover:underline">{document.number}</Link>
        </span>
      ) : (
        <span>No schedule document yet</span>
      )}
      <span aria-hidden className="text-slate-300">·</span>
      <Link href="/actions/requirements" className="font-semibold text-link hover:underline">Requirements</Link>
      <span aria-hidden className="text-slate-300">·</span>
      <Link href="/actions/schedules" className="font-semibold text-link hover:underline">Schedule versions</Link>
      {plans ? (
        <span className="ml-auto text-slate-500">
          Upload by hand:{" "}
          {BY_HAND.map(({ kind, noun }, i) => (
            <span key={kind}>
              {i ? ", " : ""}
              <Link href={`/settings/controlled/${kind}`} className="hover:text-link hover:underline">{noun}</Link>
            </span>
          ))}
        </span>
      ) : null}
    </p>
  );
}
