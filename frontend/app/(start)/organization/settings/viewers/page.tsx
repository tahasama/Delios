import { requireOrgAdmin } from "@/lib/core/org-scope";
import { Switch } from "@/components/switch";
import { ReaderLine } from "@/components/readers";
import { organizationReaders } from "@/lib/settings/viewers";
import { setOrganizationReaderAction } from "@/lib/settings/forms-viewers";
import { libertyOrFail } from "@/lib/organization/liberty";
import { fmtDate } from "@/lib/core/utils";
import { ProjectSwitches } from "../switches";
import { AskReader } from "./ask";

export const dynamic = "force-dynamic";
export const metadata = { title: "Viewing files" };

/**
 * Viewing files (owner: "all readers in that card, that we can switch on and off"): every reader the Preview may use to
 * show a source file, switched on or off for every project. One not installed here (heavy on the server) or paid is
 * asked of DELIOS by its switch, which opens the ask under it. The PDF is always shown: it is the revision's.
 */
export default async function ViewersPage() {
  await requireOrgAdmin();
  const [readers, switches] = await Promise.all([organizationReaders(), libertyOrFail()]);
  return (
    <>
      <section className="register register-sheet register-sheet-open" aria-labelledby="readers-head">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <h2 id="readers-head" className="stencil mr-1 text-slate-500">The readers</h2>
          <span className="text-[11px] text-slate-500">what a document&rsquo;s Preview shows in the page, on every project; the PDF is always shown, a file whose reader is off is downloaded</span>
        </div>
        <ul className="divide-y divide-line">
          {readers.map((reader) => (
            <ReaderLine key={reader.key} reader={reader}>
              {reader.installed ? (
                <form action={setOrganizationReaderAction} className="inline-flex">
                  <input type="hidden" name="key" value={reader.key} />
                  <input type="hidden" name="on" value={reader.on ? "off" : "on"} />
                  <Switch on={reader.on} label={reader.on ? `${reader.title}: shown on every project, switch off` : `${reader.title}: off, switch on`} />
                </form>
              ) : reader.asks ? (
                <AskReader what={reader.asks} title={reader.title}
                  asked={reader.asked ? `Asked ${fmtDate(reader.asked.at)} by ${reader.asked.byName}` : null} />
              ) : (
                <span className="text-[11px] text-slate-500">not installed here</span>
              )}
            </ReaderLine>
          ))}
        </ul>
      </section>

      <ProjectSwitches items={switches.filter((one) => one.area === "Viewing files")} />
    </>
  );
}
