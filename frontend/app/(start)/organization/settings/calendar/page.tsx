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
import { fillHolidaysAction } from "@/lib/settings/forms-calendar";
import { nationalHolidays } from "@/lib/settings/national-holidays";
import { fmtDate } from "@/lib/core/utils";
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
export default async function OrganizationCalendarPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string; country?: string }> }) {
  const scope = await requireOrgAdmin();
  const sp = await searchParams;
  const asked = Number(sp.year);
  const [calendar, switches] = await Promise.all([organizationCalendar(Number.isInteger(asked) ? asked : undefined), libertyOrFail()]);
  const year = calendar.year;
  // A country's public holidays, proposed from a list that knows them (owner), read first, then added at once.
  // Whose holidays are shown is kept in the address (owner: "do not save"): the country chosen, else where a new
  // project's site starts; ALL is every country's, as marked.
  const country = sp.country === "ALL" ? "" : /^[A-Z]{2}$/.test(sp.country ?? "") ? sp.country! : calendar.place.country ?? "";
  const fill = country || null;
  const proposed = fill ? nationalHolidays(fill, year) : [];
  const marked = new Set(calendar.holidays.filter((h) => h.country === fill).map((h) => h.day));
  const fresh = proposed.filter((h) => !marked.has(h.day));
  const countryWords = fill ? COUNTRIES.find((c) => c.code === fill)?.name ?? fill : null;
  const at = (y: number, m: string) => `/organization/settings/calendar?year=${y}&month=${y}-${m}${sp.country ? `&country=${sp.country}` : ""}#holidays`;
  const step = (y: number, Icon: typeof ChevronLeft, label: string) => (
    <Link href={`/organization/settings/calendar?year=${y}${sp.country ? `&country=${sp.country}` : ""}#holidays`} scroll={false} title={label} aria-label={label}
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
          <MonthsCalendar daySize={calendarDay((await cookies()).get(PREF.calendarDay)?.value)} namesShown={(await cookies()).get(PREF.calendarNames)?.value !== "0"} from={`${year}-01-01`} to={`${year}-12-31`} weekend={calendar.place.weekendDays} daysOff={calendar.holidays}
            claim={{ level: "organization", defaultCountry: calendar.place.country }} countries={COUNTRIES}
            month={/^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month : undefined}
            before={at(year - 1, "12")} after={at(year + 1, "01")}
            country={country} known={proposed} today={new Date().toISOString().slice(0, 10)} />
        </div>
      </section>

      {fill ? (
        <section id="fill" className="register register-sheet register-sheet-open scroll-mt-24">
          {band(`${countryWords}'s public holidays in ${year}`, "as a list that knows each country's gives them; drawn dashed on the calendar until marked")}
          <div className="space-y-3 px-5 py-4 sm:px-6">
            {proposed.length ? (
              <>
                <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
                  {proposed.map((h) => (
                    <li key={h.day} className={marked.has(h.day) ? "text-slate-400" : undefined}>
                      <span className="font-mono tabular-nums">{fmtDate(h.day)}</span> · <span className="font-semibold">{h.name}</span>
                      {marked.has(h.day) ? " · marked" : null}
                    </li>
                  ))}
                </ul>
                {fresh.length ? (
                  <ActionForm action={fillHolidaysAction} hidden={{ country: fill, year: String(year) }}
                    submitLabel={`Mark these ${fresh.length}`}
                    confirmText={`From now on: these ${fresh.length} days are public holidays in ${countryWords}, skipped by every project there when counting due days. Instead of: working days. Go ahead?`}
                    className="space-y-0" />
                ) : <p className="text-xs text-slate-500">Every one of them is marked.</p>}
                <p className="text-[11px] text-slate-500">Marked one by one or all at once, each is kept as marked by hand: a click on its day takes it off. A list can miss a local or a moved holiday: check them.</p>
              </>
            ) : <p className="text-xs text-slate-500">The list knows no public holidays for {countryWords} in {year}: mark them by a click on their days.</p>}
          </div>
        </section>
      ) : null}

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
