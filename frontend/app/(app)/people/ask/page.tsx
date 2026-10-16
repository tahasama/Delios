import { redirect } from "next/navigation";

/** Asking for someone to join is on the project directory now; the address still works. */
export default function AskToJoinPage() {
  redirect("/directory");
}
