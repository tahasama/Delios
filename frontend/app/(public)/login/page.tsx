import { api } from "@/lib/client";
import { LoginScreen } from "./login-form";

/** The sign-in page, with how to reach DELIOS support for whoever cannot sign in (set in the console). */
export default async function LoginPage() {
  const contact = await api<{ email: string | null; hours: string | null; phone: string | null }>("/api/legal/support-contact")
    .catch(() => ({ email: null, hours: null, phone: null }));
  return <LoginScreen contact={contact} />;
}
