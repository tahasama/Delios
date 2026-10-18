import { redirect } from "next/navigation";

/** Verdicts are kept in Types & sets, as the list Review outcomes and its sets (owner); the old address leads there. */
export default function VerdictListsPage() {
  redirect("/settings/config?set=REVIEW_OUTCOMES");
}
