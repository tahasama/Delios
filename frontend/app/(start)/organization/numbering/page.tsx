import { redirect } from "next/navigation";

/** The organization's numbering is a card of its Settings. */
export default function OldNumbering() {
  redirect("/organization/settings/numbering");
}
