import { ButtonLink } from "@/components/ui";
import { Plus } from "lucide-react";

/**
 * The log's masthead, read as the title block on a drawing — the same plate the
 * document register carries, because they are two registers of one project and
 * ought to look like it.
 */
export function TransmittalPlate({ project, canCreate, canSend = false, onBehalf = false }: {
  project: { code: string; name: string };
  canCreate: boolean;
  /** Another organization sends to us here; Document Control records what one sent outside the system. */
  canSend?: boolean;
  onBehalf?: boolean;
}) {
  return (
    <div className="border-b border-line px-5 pt-6 pb-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="plate-title min-w-0 text-slate-950">Transmittals</h1>
        <div className="flex flex-wrap gap-2">
          {canSend ? (
            <ButtonLink href="/transmittals/send" variant="secondary">
              {onBehalf ? "Record what came in" : "Send to us"}
            </ButtonLink>
          ) : null}
          {canCreate ? (
            <ButtonLink href="/transmittals/new">
              <Plus className="h-4 w-4" /> New transmittal
            </ButtonLink>
          ) : null}
        </div>
      </div>
      <p className="mt-1 max-w-xl text-[11.5px] leading-4 text-slate-500">
        Every formal handover of documents, in or out. Opening one while signed in is the receipt — there is nothing to confirm.
      </p>
    </div>
  );
}
