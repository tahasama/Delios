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
    <div className="border-b border-line px-5 pt-6 pb-3 sm:px-6">
      {/* The project is named in the header of every page and in the switcher
          beside it. Repeating it here is a line of chrome that says nothing the
          reader did not already know. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="plate-title min-w-0 text-slate-950">Document register</h1>
        {canCreate ? (
          <ButtonLink href="/documents/new">
            <Plus className="h-4 w-4" /> Create document
          </ButtonLink>
        ) : null}
      </div>
      <p className="mt-1 max-w-xl text-[11.5px] leading-4 text-slate-500">
        Every controlled document on this project, one row each, showing the revision in hand now.
      </p>
    </div>
  );
}
