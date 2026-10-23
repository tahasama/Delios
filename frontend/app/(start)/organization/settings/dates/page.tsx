import { redirect } from "next/navigation";

/** How dates read is on the organization's Calendar card now. */
export default function DatesPage() {
  redirect("/organization/settings/calendar#dates");
}
