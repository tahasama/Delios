import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { Switch } from "@/components/switch";
import { ReaderLine } from "@/components/readers";
import { projectReaders } from "@/lib/settings/viewers";
import { setProjectReaderAction } from "@/lib/settings/forms-viewers";
import { ExceptionNote } from "@/lib/settings/exception";
import { SETUP_PAGES, maySetup } from "../setup-pages";
import { NoAccess } from "../no-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Viewing files" };

/**
 * The project's Viewing files (owner: "in project level we can only see the available ones to switch on/off"): the
 * readers the organization has on, each switched off or back on for this project by the control function, where the
 * organization leaves it free. Read by everyone of ours.
 */
export default async function ProjectViewersPage() {
  const ctx = await requireScope();
  if (!maySetup(ctx.user, SETUP_PAGES.find((p) => p.href === "/settings/viewers")!)) return <NoAccess title="Viewing files" who="control" />;
  const { readers, mayChange, free, exception } = await projectReaders(ctx);
  const project = ctx.project.code;
  return (
    <div className="space-y-4">
      <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
        <Link href="/settings" className="hover:underline">{project} · Settings</Link>
      </p>
      <section className="register register-sheet register-sheet-open" aria-labelledby="readers-head">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <h2 id="readers-head" className="stencil mr-1 text-slate-500">The readers</h2>
          <span className="text-[11px] text-slate-500">
            {mayChange ? "those the organization has on; one switched off here, its files are downloaded"
              : free ? "whoever acts as the control function switches them on this project"
                : "the organization keeps them the same on every project"}
          </span>
        </div>
        {exception ? (
          <p className="border-b border-line px-5 py-2.5 text-xs text-slate-600 sm:px-6"><ExceptionNote project={project} what="the readers" exception={exception} /></p>
        ) : null}
        {readers.length ? (
          <ul className="divide-y divide-line">
            {readers.map((reader) => (
              <ReaderLine key={reader.key} reader={reader}>
                {mayChange ? (
                  <form action={setProjectReaderAction} className="inline-flex">
                    <input type="hidden" name="key" value={reader.key} />
                    <input type="hidden" name="on" value={reader.on ? "off" : "on"} />
                    <Switch on={reader.on} label={reader.on ? `${reader.title}: shown on ${project}, switch off` : `${reader.title}: off on ${project}, switch on`} />
                  </form>
                ) : (
                  <span className={`text-xs font-semibold ${reader.on ? "text-emerald-800" : "text-slate-500"}`}>{reader.on ? "On" : "Off"}</span>
                )}
              </ReaderLine>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-3 text-xs text-slate-600 sm:px-6">The organization has no reader on: source files are downloaded. The PDF is always shown.</p>
        )}
      </section>
    </div>
  );
}
