import { fmtDate } from "@/lib/utils";

type Moved = { wasStart: Date | null; wasFinish: Date | null; in: string } | null;

const span = (start: Date | null, finish: Date | null) =>
  !start ? "no date" : finish && finish.getTime() !== start.getTime() ? `${fmtDate(start)} to ${fmtDate(finish)}` : fmtDate(start);

/**
 * What the latest schedule read did to an action's dates, in one sentence:
 * "Moved by rev C: was 3 Oct 2026 to 5 Oct 2026, now 10 Oct 2026 to 12 Oct 2026."
 * Null when the latest read left it where it was.
 */
export function movedPhrase(moved: Moved, start: Date | null, finish: Date | null): string | null {
  if (!moved) return null;
  return `Moved by ${moved.in}: was ${span(moved.wasStart, moved.wasFinish)}, now ${span(start, finish)}.`;
}
