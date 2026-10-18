import { requireOrgAdmin } from "@/lib/core/org-scope";
import { orgSettings } from "@/lib/settings/api";
import { TrackingSheet } from "../../tracking";

export const dynamic = "force-dynamic";
export const metadata = { title: "What is kept about people's activity" };

/** What is kept about people's activity: the organization's choice, for every project. */
export default async function TrackingPage() {
  await requireOrgAdmin();
  const answers = await orgSettings().catch(() => new Map<string, string>());
  return <TrackingSheet reading={answers.get("TRACK_READING") !== "OFF"} signIns={answers.get("TRACK_SIGN_INS") === "ON"} />;
}
