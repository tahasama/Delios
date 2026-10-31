import type { Scope } from "@/lib/core/scope";
import { latenessOf } from "@/lib/actions/action-lateness";
import { NeededTable, type NeededRow } from "./needed-table";

type Slip = Awaited<ReturnType<typeof latenessOf>>["rows"][number];

/**
 * The action's documents with where each got late, read on its own (owner, the ten states): the table is drawn at once
 * without it, and filled in when it comes; failing, the table stays and says so under it (`Part`).
 */
export async function NeededWithLateness({ ctx, actionId, rowsOf, table }: {
  ctx: Scope;
  actionId: string;
  rowsOf: (delayOf: Map<string, Slip>) => NeededRow[];
  table: Omit<React.ComponentProps<typeof NeededTable>, "rows">;
}) {
  const lateness = await latenessOf(ctx, actionId);
  return <NeededTable rows={rowsOf(new Map(lateness.rows.map((row) => [row.docNumber, row])))} {...table} />;
}
