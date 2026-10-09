/**
 * The schedule's masthead. The dates come from the released schedule document,
 * read on its own, so what is said here is the day those dates came into
 * force — not the name of whatever tool they were planned in.
 */
export function PlanPlate({ inForceSince }: {
  /** The day the schedule in force was released, or null when none is read yet. */
  inForceSince: string | null;
}) {
  return (
    <div className="border-b border-line px-5 pt-6 pb-3 sm:px-6">
      <h1 className="plate-title min-w-0 text-slate-950">Schedule &amp; actions</h1>
      <p className="mt-1 max-w-2xl text-[11.5px] leading-4 text-slate-500">
        {inForceSince
          ? <>Dates in force since {inForceSince}. Each action is a day the project has to be ready for, and what it needs is the documents its disciplines listed.</>
          : <>No schedule has been released yet, so there are no dates to be ready for. Release the schedule document and every action follows from it.</>}
      </p>
    </div>
  );
}
