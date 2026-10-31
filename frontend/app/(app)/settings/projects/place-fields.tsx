import { Select } from "@/components/select";
import { Field } from "@/components/ui";
import { COUNTRIES } from "@/lib/organization/countries";
import type { Place } from "@/lib/settings/place";

/** A field as on the new-document form: grey, no box, inside the sheet's `asking` body. */
const field = "plain w-full";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Every time zone the server knows, UTC first. */
const ZONES = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((z) => z !== "UTC")];

/**
 * Where a project's site is (owner): its country (which public holidays its due days skip), its time zone (the day due
 * days are counted from) and the days it does not work. The same fields open a project, change its line, and set where
 * every new project starts (Defaults for new projects).
 */
export function PlaceFields({ place }: { place: Place }) {
  return (
    <>
      <Field label="Country" hint="its public holidays are skipped when due days are counted">
        <Select name="country" defaultValue={place.country ?? ""} className={field}>
          <option value="">None — only holidays kept for every country</option>
          {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Time zone" hint="the site's: today, and every due day, are counted in it">
        <Select name="timeZone" defaultValue={place.timeZone} className={field}>
          {(ZONES.includes(place.timeZone) ? ZONES : [place.timeZone, ...ZONES]).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
        </Select>
      </Field>
      <Field label="Days off each week" hint="due days skip them" className="sm:col-span-2">
        <input type="hidden" name="sendsWeekend" value="1" />
        <span className="flex h-(--control-h) flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-700">
          {DAYS.map((day, i) => (
            <label key={day} className="flex items-center gap-1.5">
              <input type="checkbox" name="weekend" value={i + 1} defaultChecked={place.weekendDays.includes(i + 1)} /> {day}
            </label>
          ))}
        </span>
      </Field>
    </>
  );
}
