import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { ActionForm } from "@/components/form";
import { MonthsCalendar } from "@/components/calendar";
import { PlaceFields } from "../projects/place-fields";
import { projectCalendar } from "@/lib/settings/calendar";
import { setSitePlaceAction } from "@/lib/settings/forms-calendar";
import { ExceptionNote } from "@/lib/settings/exception";
import { countryName } from "@/lib/organization/countries";
import { SETUP_PAGES, maySetup } from "../setup-pages";
import { NoAccess } from "../no-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar" };

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * The project's calendar (owner), from the month it starts to the month it finishes: where its site is (country, time
 * zone, days off each week), the public holidays of its country read from the organization's, and its own days off,
 * claimed by a click on a day where the organization leaves the calendar free. The schedule's action days are on it.
 * Read by everyone of ours; changed by the control function.
 */
export default async function ProjectCalendarPage() {
  const ctx = await requireScope();
  if (!maySetup(ctx.user, SETUP_PAGES.find((p) => p.href === "/settings/calendar")!)) return <NoAccess title="Calendar" who="control" />;
  const calendar = await projectCalendar(ctx);
  const project = ctx.project.code;
  const claims = calendar.mayChange && calendar.ownDaysFree;
  const band = (title: string, said: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
      <h2 className="stencil mr-1 text-slate-500">{title}</h2>
      <span className="text-[11px] text-slate-500">{said}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
        <Link href="/settings" className="hover:underline">{project} · Settings</Link>
      </p>

      <section id="place" className="register register-sheet register-sheet-open scroll-mt-24">
        {band("Where the site is", "today, and every due day, are counted at the site; its country's holidays are skipped")}
        {calendar.mayChange ? (
          <ActionForm action={setSitePlaceAction} submitLabel="Save" className="asking space-y-4 px-5 py-4 sm:px-6">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2"><PlaceFields place={calendar.place} /></div>
          </ActionForm>
        ) : (
          <dl className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {[
              ["Country", countryName(calendar.place.country) ?? "None"],
              ["Time zone", calendar.place.timeZone.replace(/_/g, " ")],
              ["Days off each week", calendar.place.weekendDays.map((d) => DAYS[d - 1]).join(", ") || "None"],
            ].map(([term, value]) => (
              <div key={term} className="px-5 py-3 sm:px-6">
                <dt className="stencil text-slate-500">{term}</dt>
                <dd className="mt-1 text-[13px] font-medium text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section id="calendar" className="register register-sheet register-sheet-open scroll-mt-24">
        {band("The calendar", claims
          ? "a click on a day marks it a day off for this project, or takes it off; the organization's holidays always count"
          : calendar.ownDaysFree
            ? "whoever acts as the control function marks the project's own days off"
            : "the organization keeps the calendar the same on every project: its holidays only")}
        <div className="space-y-3 px-5 py-4 sm:px-6">
          {calendar.exception ? (
            <p className="text-xs text-slate-600"><ExceptionNote project={project} what="the calendar" exception={calendar.exception} /></p>
          ) : null}
          <MonthsCalendar from={calendar.from} to={calendar.to} weekend={calendar.place.weekendDays} today={calendar.today}
            daysOff={calendar.daysOff} actions={calendar.actions} claim={claims ? { level: "project" } : undefined} />
          <p className="text-[11px] text-slate-500">
            From the month {project} starts to the month it finishes (This project). Public holidays are the organization&rsquo;s, by country.
          </p>
        </div>
      </section>
    </div>
  );
}
