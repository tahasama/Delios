import { cookies } from "next/headers";
import { PREF, calendarDay } from "@/lib/core/preferences";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireOrgAdmin } from "@/lib/core/org-scope";
import { ActionForm } from "@/components/form";
import { MonthsCalendar } from "@/components/calendar";
import { PlaceFields } from "@/app/(app)/settings/projects/place-fields";
import { organizationCalendar } from "@/lib/settings/calendar";
import { libertyOrFail } from "@/lib/organization/liberty";
import { setDateFormatAction, setProjectPlaceAction } from "@/lib/organization/forms";
import { DATE_FORMATS } from "@/lib/core/date-format";
import { COUNTRIES } from "@/lib/organization/countries";
import { ProjectSwitches } from "../switches";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar" };

const band = (title: string, said: string) => (
  <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
    <h2 className="stencil mr-1 text-slate-500">{title}</h2>
    <span className="text-[11px] text-slate-500">{said}</span>
  </div>
);

/**
 * The organization's calendar (owner: one card for what is about days): the public holidays, a year at a time, each
 * claimed by a click on its day (its name, the country it is kept in, or every country) and unclaimed the same way; how
 * dates read on every screen; where a new project's site starts. Its switch says whether a project may add its own days
 * off.
 */
export default async function OrganizationCalendarPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const scope = await requireOrgAdmin();
  const asked = Number((await searchParams).year);
  const [calendar, switches] = await Promise.all([organizationCalendar(Number.isInteger(asked) ? asked : undefined), libertyOrFail()]);
  const year = calendar.year;
  const step = (y: number, Icon: typeof ChevronLeft, label: string) => (
    <Link href={`/organization/settings/calendar?year=${y}#holidays`} scroll={false} title={label} aria-label={label}
      className="inline-flex rounded-sm p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
      <Icon className="h-4 w-4" aria-hidden />
    </Link>
  );

  return (
    <>
      <p className="font-mono text-[12.5px] font-semibold tracking-tight text-slate-500">
        <Link href="/organization/settings" className="hover:underline">{scope.organization.name} · Settings</Link>
      </p>

      <section id="holidays" className="register register-sheet register-sheet-open scroll-mt-24">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
          <h2 className="stencil mr-1 text-slate-500">Public holidays</h2>
          <span className="text-[11px] text-slate-500">a click on a day marks it, or takes it off; every project in its country skips it when counting due days</span>
          <span className="ml-auto flex items-center gap-1 text-[13px] font-semibold text-slate-800">
            {step(year - 1, ChevronLeft, `${year - 1}`)}{year}{step(year + 1, ChevronRight, `${year + 1}`)}
          </span>
        </div>
        <div className="px-5 py-4 sm:px-6">
          <MonthsCalendar dayHeight={calendarDay((await cookies()).get(PREF.calendarDay)?.value)} from={`${year}-01-01`} to={`${year}-12-31`} weekend={calendar.place.weekendDays} daysOff={calendar.holidays}
            claim={{ level: "organization", defaultCountry: calendar.place.country }} countries={COUNTRIES} />
        </div>
      </section>

      <section id="dates" className="register register-sheet register-sheet-open scroll-mt-24">
        {band("How dates read", "on every screen of every project, the same for everyone")}
        <ActionForm action={setDateFormatAction} submitLabel="Save" className="asking space-y-3 px-5 py-4 sm:px-6">
          <div className="grid grid-cols-1 gap-2 text-xs font-medium text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
            {DATE_FORMATS.map((one) => (
              <label key={one.code} className="flex items-center gap-1.5">
                <input type="radio" name="format" value={one.code} defaultChecked={one.code === calendar.dateFormat} required />
                <span className="font-mono text-[13px] text-slate-900">{one.example}</span>
                <span className="text-slate-500">{one.label}</span>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">Exports and the stamp keep their own way of writing dates. A time always reads on 24 hours.</p>
        </ActionForm>
      </section>

      <section id="place" className="register register-sheet register-sheet-open scroll-mt-24">
        {band("Where a new project's site is", "a new project starts with these, then keeps its own; projects already open keep theirs")}
        <ActionForm action={setProjectPlaceAction} submitLabel="Save" className="asking space-y-4 px-5 py-4 sm:px-6">
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <PlaceFields place={calendar.place} />
          </div>
        </ActionForm>
      </section>

      <ProjectSwitches items={switches.filter((one) => one.area === "Calendar")} />
    </>
  );
}
