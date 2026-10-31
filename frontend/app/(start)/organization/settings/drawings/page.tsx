import { redirect } from "next/navigation";

/** Viewing drawings became Viewing files, every reader on one card. */
export default function DrawingsPage() {
  redirect("/organization/settings/viewers");
}
