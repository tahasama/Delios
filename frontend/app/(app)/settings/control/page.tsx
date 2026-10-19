import Link from "next/link";
import { SETUP_PAGES, maySetup, mayChangeControlRoom, CONTROL_ROOM } from "../setup-pages";
import { requireScope } from "@/lib/core/scope";
import { isAdmin } from "@/lib/core/auth";
import { Chip } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { SearchPick } from "@/components/search-pick";
import { api, projectPath } from "@/lib/client";
import { setControlPeopleAction } from "@/lib/settings/forms-people";
import { projectSettings, holders } from "@/lib/settings/api";
import { projectDefaults } from "@/lib/organization/defaults";
import { liberty } from "@/lib/organization/liberty";
import { scheduleSource } from "@/lib/actions/api";
import { stateNames } from "@/lib/core/state-names";
import type { AnswerSource } from "@/components/how-it-works";
import { ProjectSettings } from "./project-settings";
import { NoAccess } from "../no-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "How this project works" };

/**
 * Every answer of how the project works, in one card: who acts as the control function, who carries out each act,
 * what releasing, stamping and the matrix mean here, the days around an action, the states' names, and the way back
 * to the defaults. The Control room shows the flows and leads here; nothing is changed there.
 */
export default async function HowThisProjectWorksPage() {
  const ctx = await requireScope();
  const { user: me } = ctx;
  const page = SETUP_PAGES.find((one) => one.href === "/settings/control")!;
  if (!maySetup(me, page)) return <NoAccess title="How this project works" who="admin" />;
  const changesIt = mayChangeControlRoom(me);

  const [answers, controllers, names, defaults, switches, schedule] = await Promise.all([
    projectSettings(ctx.projectId).catch(() => new Map<string, string>()),
    holders(ctx.projectId, "CONTROL").catch(() => []),
    stateNames(ctx),
    projectDefaults().catch(() => null),
    liberty(),
    scheduleSource(ctx),
  ]);
  const directory = await api<{
    people: { id: string; name: string; partyId: string | null; function: string; control: boolean; actsAsControl: boolean }[];
    organizations: { id: string; kind: string }[];
    mayNameControl: boolean;
  }>(projectPath(ctx, "/people/directory")).catch(() => null);
  const ours = new Set(directory?.organizations.filter((o) => o.kind === "OURS").map((o) => o.id) ?? []);
  const ourPeople = (directory?.people ?? []).filter((p) => p.partyId === null || ours.has(p.partyId));
  const byFunction = ourPeople.filter((p) => p.control && !p.actsAsControl);
  // What the organization keeps the same on every project is read only here (ROOM_FIXED).
  const source: AnswerSource = {
    target: "project",
    answers,
    base: defaults?.values ?? null,
    fixed: switches.filter((one) => one.area === "Control room" && !one.free).map((one) => one.key),
  };

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 pt-6 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">How this project works</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            Every answer about how {ctx.project.code} works, in one place. What changes here changes this project only.
            {changesIt ? "" : " You read it; an administrator or the control function changes it."}{" "}
            <Link href={CONTROL_ROOM} className="font-semibold text-link hover:underline">See it on the flows, in the Control room</Link>.
          </p>
        </div>
      </section>

      {/* Who acts as the control function: named here, whatever their function. */}
      {directory ? (
        <section className="register register-sheet register-sheet-open scroll-mt-24" id="control-people" aria-labelledby="control-people-head">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
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
            {directory.mayNameControl ? (
              <ActionForm action={setControlPeopleAction} submitLabel="Save" size="sm">
                <div className="max-w-xl">
                  <SearchPick name="userIds" label={`Named on ${ctx.project.code}`} hint="people of ours on the project; each is told"
                    items={ourPeople.filter((p) => !byFunction.some((b) => b.id === p.id)).map((p) => ({ id: p.id, name: p.name, detail: p.function }))}
                    initial={ourPeople.filter((p) => p.actsAsControl).map((p) => p.id)} placeholder="Find someone" />
                  <p className="mt-1.5 text-[11px] leading-4 text-slate-500">Nobody named, and no function carrying it: the project has no control function, and the people doing the work carry its acts out themselves.</p>
                </div>
              </ActionForm>
            ) : (
              <p className="text-xs leading-5 text-slate-600">
                Named on {ctx.project.code}: {ourPeople.filter((p) => p.actsAsControl).map((p) => p.name).join(", ") || "nobody"}. An administrator, or whoever acts as the control function, names them.
              </p>
            )}
          </div>
        </section>
      ) : null}

      <ProjectSettings
        source={source}
        follows={controllers.length > 0}
        names={names}
        defaults={defaults}
        schedule={schedule.source ? { defaultLeadDays: schedule.source.defaultLeadDays ?? null, riskWindowDays: schedule.source.riskWindowDays ?? null } : null}
        riskFixed={switches.some((one) => one.key === "RISK_WINDOW" && !one.free)}
        admin={isAdmin(me)}
        readOnly={!changesIt}
      />
    </div>
  );
}
