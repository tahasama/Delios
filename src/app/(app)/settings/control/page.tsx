import { redirect } from "next/navigation";

/** Who does what is part of the Control room now; the address still works. */
export default function WhoDoesWhatPage() {
  redirect("/settings/flow");
}
