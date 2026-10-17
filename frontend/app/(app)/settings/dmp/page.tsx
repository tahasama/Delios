import { redirect } from "next/navigation";

/** The plan is a document, not a setting: it is read under Assurance. The address is kept for links already made. */
export default function OldPlanPage() {
  redirect("/conformance/plan");
}
