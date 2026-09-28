import { ButtonLink } from "@/components/ui";
import { Plus } from "lucide-react";

/**
 * The log's masthead, read as the title block on a drawing — the same plate the
 * document register carries, because they are two registers of one project and
 * ought to look like it.
 */
export function TransmittalPlate({ project, canCreate }: {
  project: { code: string; name: string };
  canCreate: boolean;
}) {
  return (
    <div className="border-b border-line px-4 pb-2.5 pt-3 sm:px-5">
      <p className="stencil text-slate-400">
        <span className="font-mono tracking-normal text-slate-500">{project.code}</span>
        <span className="mx-1.5 text-slate-300">/</span>
        {project.name}
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="plate-title min-w-0 text-slate-950">Transmittals</h1>
        {canCreate ? (
          <ButtonLink href="/transmittals/new">
            <Plus className="h-4 w-4" /> New transmittal
          </ButtonLink>
        ) : null}
      </div>
      <p className="mt-0.5 max-w-xl text-[11px] leading-4 text-slate-500">
        Every formal handover of documents, in or out. Opening one while signed in is the receipt — there is nothing to confirm.
      </p>
    </div>
  );
}
