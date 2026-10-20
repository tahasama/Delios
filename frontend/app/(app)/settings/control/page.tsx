import { redirect } from "next/navigation";

/**
 * "How this project works" is gone (owner): its answers are changed in the Control room, step by step, and read as
 * written sentences in the plan; who acts as the control function and the way back to the defaults sit under the
 * Control room's flows, and what the states are called is the organization's card.
 */
export default function HowThisProjectWorksPage() {
  redirect("/settings/flow");
}
