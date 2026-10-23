import { fmtDate } from "@/lib/core/utils";

/** A setting the organization keeps fixed, left free on one project all the same: who decided it, when, and why. */
export type ExceptionHere = { reason: string; by: string; at: string } | null | undefined;

/**
 * Said on a project's Settings page when it may change a setting only by an exception (owner): every other project
 * takes the organization's; this one may keep its own, for the reason the administrator gave.
 */
export function ExceptionNote({ project, what, exception }: { project: string; what: string; exception: NonNullable<ExceptionHere> }) {
  return (
    <>
      Free here by an exception: the organization keeps {what} the same on every other project, and lets {project} change
      it (&ldquo;{exception.reason}&rdquo;, {exception.by}, {fmtDate(exception.at)}).
    </>
  );
}
