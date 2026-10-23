import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { MonthsCalendar } from "@/components/calendar";
import { projectCalendar } from "@/lib/settings/calendar";
import { countryName } from "@/lib/organization/countries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar" };

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * The project's calendar for everyone (owner): from the month it starts to the month it finishes, the days that do not
 * count as working days (days off each week, the public holidays of its country, its own days off) and, for our own
 * people, the schedule's action days. A day opened says what it holds; each action opens its page. Read only: the days
 * off are kept in Settings → Calendar.
 */
export default async function CalendarPage() {
  const ctx = await requireScope();
  const calendar = await projectCalendar(ctx);
  const off = calendar.daysOff.length;
  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="flex flex-col gap-3 px-5 pt-6 pb-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="min-w-0">
            <h1 className="plate-title text-slate-950">Calendar</h1>
            <p className="plate-meta mt-2">
              {ctx.project.code} · {countryName(calendar.place.country) ?? "no country"} · {calendar.place.timeZone.replace(/_/g, " ")}
              {" "}· days off {calendar.place.weekendDays.map((d) => DAYS[d - 1].slice(0, 3)).join(", ") || "none"}
            </p>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              Which days count as working days on {ctx.project.code}: due days for reviews and answers skip the others.
              {calendar.actions.length ? " The schedule's actions are drawn on their days; a day opened lists them." : null}
            </p>
          </div>
          {calendar.mayChange ? (
            <Link href="/settings/calendar" className="ask shrink-0">Change the days off</Link>
          ) : null}
        </div>
        <dl className="grid grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            ["Days off marked", `${off}`],
            ["Actions on it", `${calendar.actions.length}`],
            ["Spans", `${calendar.from.slice(0, 7)} → ${calendar.to.slice(0, 7)}`],
          ].map(([term, value]) => (
            <div key={term} className="px-5 py-3 sm:px-6">
              <dt className="stencil text-slate-500">{term}</dt>
              <dd className="mt-1 text-[13px] font-medium text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="register register-sheet register-sheet-open px-5 py-4 sm:px-6">
        <MonthsCalendar from={calendar.from} to={calendar.to} weekend={calendar.place.weekendDays} today={calendar.today}
          daysOff={calendar.daysOff} actions={calendar.actions} />
      </section>
    </div>
  );
}
