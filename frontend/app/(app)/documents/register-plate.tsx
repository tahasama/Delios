import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { Plus } from "lucide-react";

/**
 * The register's masthead, read as the title block on a drawing: what this is,
 * of which project, and the one thing you come here to start. How the project
 * is doing belongs to Reports; what is waiting on you belongs to Home. A
 * register states what it holds.
 */
export function RegisterPlate({ project, canCreate, showing = "controlled", ours = false }: {
  project: { code: string; name: string };
  canCreate: boolean;
  /** Which register: the controlled documents, or what is kept uncontrolled (owner: "clearly marked uncontrolled"). */
  showing?: "controlled" | "uncontrolled";
  /** Our people: the switch between the two registers (the uncontrolled one is ours only). */
  ours?: boolean;
}) {
  return (
    <div className="border-b border-line px-5 pt-5 pb-2.5 sm:px-6">
      {/* The project is named in the header of every page and in the switcher
          beside it. Repeating it here is a line of chrome that says nothing the
          reader did not already know. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="plate-title min-w-0 text-slate-950">{showing === "uncontrolled" ? "Uncontrolled documents" : "Document register"}</h1>
        {canCreate ? (
          <ButtonLink href="/documents/new">
            <Plus className="h-4 w-4" /> Create document
          </ButtonLink>
        ) : null}
      </div>
      <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
        {showing === "uncontrolled"
          ? "Every file kept outside the register: how it came, on what, from whom and when."
          : "Every controlled document on this project, one row each, showing the revision in hand now."}
      </p>
      {/* Which register, under the line saying what it holds, as Packages' two kinds (owner: "we will do register like
          packages and put the switch under subtitle"). */}
      {ours ? (
        <div className="mt-3">
          <nav aria-label="Which register" className="seg w-fit max-w-full">
            <Link href="/documents" aria-current={showing === "controlled" ? "page" : undefined} className="segment">Controlled</Link>
            <Link href="/documents/uncontrolled" aria-current={showing === "uncontrolled" ? "page" : undefined} className="segment">Uncontrolled</Link>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
