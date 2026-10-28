import { AuthShell } from "@/app/(public)/login/shell";
import { SignInForm } from "./form";

export const metadata = { title: "Console sign-in" };

/** The DELIOS team signs in here, never with an organization's account: email, password and an authenticator's code. */
export default function ConsoleSignIn() {
  return (
    <AuthShell>
      <h2 className="text-xl font-semibold text-slate-900">DELIOS console</h2>
      <p className="mt-1 text-sm text-slate-500">For the team that runs DELIOS. An organization&rsquo;s account does not open it.</p>
      <SignInForm />
    </AuthShell>
  );
}
