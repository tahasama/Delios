import Link from "next/link";

/**
 * The schedule's masthead. The dates come from the approved schedule, which is
 * a controlled list with a version of its own — so what is said here is the day
 * those dates came into force, not the name of whatever tool they were planned
 * in, and not a second version number beside the list's own.
 */
export function PlanPlate({ inForceSince, drafts }: {
  /** The day the schedule in force was approved, or null when none is loaded. */
  inForceSince: string | null;
  /** Uploads waiting on a decision, which anybody reading dates should know about. */
  drafts: number;
}) {
  return (
    <div className="border-b border-line px-5 pt-6 pb-3 sm:px-6">
      <h1 className="plate-title min-w-0 text-slate-950">Schedule &amp; actions</h1>
      <p className="mt-1 max-w-2xl text-[11.5px] leading-4 text-slate-500">
        {inForceSince
          ? <>Dates in force since {inForceSince}. Each action is a day the project has to be ready for, and what it needs is the documents its disciplines listed.</>
          : <>No schedule has been uploaded yet, so there are no dates to be ready for. Upload one and every action follows from it.</>}
        {drafts ? (
          <> {" · "}
            <Link href="/actions/schedules" className="font-semibold text-amber-700 hover:underline">
              {drafts} upload{drafts === 1 ? "" : "s"} waiting on a decision
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}
