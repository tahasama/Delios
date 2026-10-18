import { redirect } from "next/navigation";

/** What projects may change is said on each card of the organization's Settings, beside what it is about. */
export default function OldLiberty() {
  redirect("/organization/settings");
}
