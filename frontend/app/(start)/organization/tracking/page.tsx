import { redirect } from "next/navigation";

/** A card of the organization's Settings now. */
export default function Old() {
  redirect("/organization/settings/security#tracking");
}
