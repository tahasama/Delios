import { redirect } from "next/navigation";

/** What is kept about people's activity is on Security & privacy now. */
export default function TrackingPage() {
  redirect("/organization/settings/security#tracking");
}
