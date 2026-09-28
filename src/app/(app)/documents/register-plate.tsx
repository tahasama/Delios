import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { Plus } from "lucide-react";

/**
 * The register's masthead, read as the title block on a drawing: what this is,
 * of which project, and the one thing you come here to start. How the project
 * is doing belongs to Reports; what is waiting on you belongs to Home. A
 * register states what it holds.
 */
export function RegisterPlate({ project, canCreate }: {
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
      {/* The title and the one action sit on the same line, so the eye finds
          both at once instead of hunting for the button beside a subtitle. */}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="plate-title min-w-0 text-slate-950">Document register</h1>
        {canCreate ? (
          <ButtonLink href="/documents/new">
            <Plus className="h-4 w-4" /> Create document
          </ButtonLink>
        ) : null}
      </div>
      <p className="mt-0.5 max-w-xl text-[11px] leading-4 text-slate-500">
        Every controlled document on this project, one row each, showing the revision in hand now.
      </p>
    </div>
  );
}
