import { redirect } from "next/navigation";

/** Sign-in & security is the organization's (owner): it lives in the organization's Settings. */
export default function SecurityPage() {
  redirect("/organization/settings/security");
}
