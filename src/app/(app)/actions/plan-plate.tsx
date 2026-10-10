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
    <div className="border-b border-line px-5 pt-5 pb-2.5 sm:px-6">
      <h1 className="plate-title min-w-0 text-slate-950">Schedule &amp; actions</h1>
      <p className="mt-1 max-w-2xl text-[11.5px] leading-4 text-slate-500">
        {inForceSince
          ? <>Each action is a day the project must be ready for, with the documents its disciplines need.</>
          : <>No schedule yet: upload it below, and every action follows from it.</>}
      </p>
    </div>
  );
}
