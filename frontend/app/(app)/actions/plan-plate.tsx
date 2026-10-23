import Link from "next/link";

/**
 * The schedule's masthead. The dates come from the released schedule document,
 * read on its own, so what is said here is the day those dates came into
 * force — not the name of whatever tool they were planned in. Who reads it
 * decides the next sentence: a planner is told what to do, everyone else who
 * does it. A schedule whose last read failed says so here, where it is seen.
 */
export function PlanPlate({ inForce, plans, failed, days }: {
  /** The schedule in force and the day it was released; null when none is read yet. */
  inForce: { since: string | null } | null;
  /** The reader uploads the schedule's lists (the control function, or the Plan permission). */
  plans: boolean;
  /** The newest read of the schedule failed: which revision, and why. */
  failed: { revision: string; error: string | null } | null;
  /** The days around an action in force (owner: "i dont remember where we can change it"), and whether they are the project's own. */
  days?: { lead: number; risk: number; own: boolean } | null;
}) {
  return (
    <div className="border-b border-line px-5 pt-5 pb-2.5 sm:px-6">
      <h1 className="plate-title min-w-0 text-slate-950">Schedule</h1>
      <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
        {inForce
          ? <>{inForce.since ? `Dates from the schedule released on ${inForce.since}.` : "Dates from the released schedule."}</>
          : plans
            ? <>No schedule yet: upload it below, and every action follows from it.</>
            : <>No schedule yet. The control function, or whoever plans the project, uploads it; every action follows from it.</>}
      </p>
      {days ? (
        <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
          A document is needed {days.lead} day{days.lead === 1 ? "" : "s"} before its action&rsquo;s day, unless the requirements list says otherwise;
          an action is at risk from {days.risk} day{days.risk === 1 ? "" : "s"} before{days.own ? " (this project's own)" : ""}.{" "}
          <Link href="/settings/flow" className="font-semibold text-link hover:underline">Set in the Control room</Link>, an action on the schedule.
        </p>
      ) : null}
      {failed ? (
        <p className="mt-2 max-w-2xl rounded-md bg-red-50 px-2.5 py-1.5 text-xs leading-5 text-red-900 ring-1 ring-red-200">
          The schedule of rev {failed.revision} could not be read{failed.error ? `: ${failed.error}` : "."} {inForce ? " The dates shown are still the ones from before it." : " No dates are in force yet."}
        </p>
      ) : null}
    </div>
  );
}
