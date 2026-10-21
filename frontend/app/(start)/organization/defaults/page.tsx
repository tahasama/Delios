import { redirect } from "next/navigation";

/** The defaults for new projects are the organization's Control room now (owner: the same console as a project's). */
export default function DefaultsPage() {
  redirect("/organization/settings/flow");
}
