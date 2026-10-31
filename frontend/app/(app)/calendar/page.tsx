import { redirect } from "next/navigation";

/** The calendar is a view of the Schedule (owner): this address only opens it there. */
export default function CalendarPage() {
  redirect("/schedule?view=calendar");
}
