import Link from "next/link";
import { Chip } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { SearchPick } from "@/components/search-pick";
import { DefaultsLink } from "@/components/how-it-works";
import { setControlPeopleAction } from "@/lib/settings/forms-people";
import { resetProjectToDefaultsAction } from "@/lib/settings/forms-how-it-works";
import { fmtDate } from "@/lib/core/utils";

const sheetHead = "flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6";

type Person = { id: string; name: string; function: string; control: boolean; actsAsControl: boolean };

/**
 * Who acts as the control function on the project, under the Control room's flows (owner: moved here from "How this
 * project works", which is gone): those whose function carries it, and those named here, whatever their function.
 */
export function ControlPeople({ project, people, mayName }: { project: string; people: Person[]; mayName: boolean }) {
  const byFunction = people.filter((p) => p.control && !p.actsAsControl);
  const named = people.filter((p) => p.actsAsControl);
  return (
    <section className="register register-sheet register-sheet-open scroll-mt-24" id="control-people" aria-labelledby="control-people-head">
      <div className={sheetHead}>
        <h2 id="control-people-head" className="stencil mr-1 text-slate-500">Who acts as the control function</h2>
        <span className="text-[11px] text-slate-500">whatever their function: they keep the register, check what arrives, add people…</span>
      </div>
      <div className="space-y-3 px-5 py-4 sm:px-6">
        {byFunction.length ? (
          <div className="space-y-1.5">
            <p className="text-xs text-slate-600">
              By their function (changed in <Link href="/settings/functions" className="font-semibold text-link hover:underline">Functions</Link>):
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {byFunction.map((p) => (
                <li key={p.id}><Chip className="bg-tint-soft text-slate-700 ring-line">{p.name}<span className="ml-1 font-normal text-slate-500">{p.function}</span></Chip></li>
              ))}
            </ul>
          </div>
        ) : null}
        {mayName ? (
          <ActionForm action={setControlPeopleAction} submitLabel="Save" size="sm">
            <div className="max-w-xl">
              <SearchPick name="userIds" label={`Named on ${project}`} hint="people of ours on the project; each is told"
                items={people.filter((p) => !byFunction.some((b) => b.id === p.id)).map((p) => ({ id: p.id, name: p.name, detail: p.function }))}
                initial={named.map((p) => p.id)} placeholder="Find someone" />
              <p className="mt-1.5 text-[11px] leading-4 text-slate-500">Nobody named, and no function carrying it: the project has no control function, and the people doing the work carry its acts out themselves.</p>
            </div>
          </ActionForm>
        ) : (
          <p className="text-xs leading-5 text-slate-600">
            Named on {project}: {named.map((p) => p.name).join(", ") || "nobody"}. An administrator, or whoever acts as the control function, names them.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Every answer of the project changed here back to the defaults (owner: moved here from "How this project works"):
 * the organization's defaults for new projects, else the app's own. What the project is, and checks switched off on it,
 * stay as they are.
 */
export function BackToDefaults({ defaults, admin }: { defaults: { at: string; by: string } | null; admin: boolean }) {
  return (
    <section id="defaults" className="register register-sheet register-sheet-open scroll-mt-24" aria-labelledby="defaults-head">
      <div className={sheetHead}>
        <h2 id="defaults-head" className="stencil mr-1 text-slate-500">Back to the defaults</h2>
        <span className="text-[11px] text-slate-500">
          {defaults ? `the organization's defaults for new projects, set ${fmtDate(defaults.at)} by ${defaults.by}` : "the organization has set no defaults: the app's own stand in"}
        </span>
      </div>
      <ActionForm
        action={resetProjectToDefaultsAction}
        submitLabel={defaults ? "Reset to the organization's defaults" : "Reset to the app's defaults"}
        variant="secondary"
        size="sm"
        confirmText="Every answer changed on this project goes back to the defaults. Go ahead?"
        className="space-y-3 px-5 py-4 sm:px-6"
      >
        <p className="text-xs leading-5 text-slate-600">
          Every answer of the Control room changed on this project goes back to {defaults ? "the organization's default" : "the app's own"}.
          What the project is, and checks switched off on it, stay as they are. The record says who did it.
        </p>
      </ActionForm>
      {admin ? (
        <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">
          The <DefaultsLink /> are changed on the organization&rsquo;s page; changing them never changes a project already open.
        </p>
      ) : null}
    </section>
  );
}
