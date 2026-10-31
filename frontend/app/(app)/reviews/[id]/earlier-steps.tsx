import { Card } from "@/components/ui";
import { fmtDateTime } from "@/lib/core/utils";
import type { Scope } from "@/lib/core/scope";
import { earlierSteps } from "@/lib/reviews/api";

/**
 * What the steps before this one said, their verdicts and comments in order, read on its own (owner, the ten states: "a
 * part of a page that loads on its own"): the review's page stands while it reads; a failure is said in its place.
 */
export async function EarlierSteps({ ctx, cycleId, labels }: { ctx: Scope; cycleId: string; labels: Record<string, string> }) {
  const earlier = await earlierSteps(ctx, cycleId);
  if (!earlier.length) return null;
  return (
    <Card title="What the earlier steps said" description="Their verdicts and their comments, in order.">
      <ul className="-my-4 divide-y divide-line">
        {earlier.map((one) => (
          <li key={one.id} className="py-3">
            <p className="text-xs font-semibold text-slate-800">
              {one.number ? <span className="mr-2 font-mono text-slate-400">{one.number}</span> : null}
              {one.outcome ? (labels[one.outcome] ?? one.outcome) : <span className="text-slate-400">not answered yet</span>}
            </p>
            {one.outcomeByName ? <p className="mt-0.5 text-[11px] text-slate-400">{one.outcomeByName}, {fmtDateTime(one.outcomeAt)}</p> : null}
            {one.comments.length ? (
              <ul className="mt-2 space-y-1.5">
                {one.comments.map((comment) => (
                  <li key={comment.id} className={`rounded-md px-2.5 py-1.5 text-xs ${comment.progressionPreventing && comment.status === "OPEN" ? "bg-red-50 text-red-900 ring-1 ring-red-200" : "bg-canvas text-slate-700"}`}>
                    {comment.text}
                    <span className="ml-1 text-[11px] text-slate-400">— {comment.authorName}{comment.progressionPreventing
                      ? comment.status === "OPEN"
                        ? comment.closesWith === "STEP" && comment.closesWithStep ? `, settled when step ${comment.closesWithStep} answers` : ", settled by the next revision"
                        : ", settled"
                      : ""}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
