import { consoleApi } from "@/lib/console/client";
import { ActionForm } from "@/components/form";
import { Field } from "@/components/ui";
import { setSupportContactAction } from "@/lib/console/forms";
import { cn, fmtDate, fmtDateTime } from "@/lib/core/utils";
import { Plate, Sheet } from "../parts";

export const metadata = { title: "Team" };

type Member = { id: string; name: string; email: string; active: boolean; createdAt: string; lastSignInAt: string | null; locked: string | null };

/** Who runs DELIOS. Added on the server only, never from a page, each with two-step sign-in. */
export default async function Team() {
  const [team, platform] = await Promise.all([consoleApi<Member[]>("/api/console/team"), consoleApi<Record<string, string>>("/api/console/platform")]);
  return (
    <>
      <Plate title="Team & support" meta="The people who run DELIOS. Their accounts open the console only, never an organization's space." />
      <Sheet title="Everyone" said={`${team.length}`}>
        <ul className="divide-y divide-line">
          {team.map((m) => (
            <li key={m.id} className={cn("px-5 py-3 text-[13px] sm:px-6", !m.active && "opacity-60")}>
              <span className="font-medium text-slate-900">{m.name}</span> <span className="text-slate-500">{m.email}</span>
              <span className="block text-[11px] text-slate-500">since {fmtDate(m.createdAt)} · last signed in {fmtDateTime(m.lastSignInAt)}{m.locked && new Date(m.locked) > new Date() ? " · locked for a few minutes" : ""}</span>
            </li>
          ))}
        </ul>
      </Sheet>
      <Sheet title="How organizations reach support" said="shown on Help, on their Contract & plan and wherever something went wrong">
        <ActionForm action={setSupportContactAction} submitLabel="Save" className="asking grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 sm:px-6 md:grid-cols-3" footerClassName="md:col-span-3">
          <Field label="Email"><input name="email" type="email" defaultValue={platform.SUPPORT_EMAIL ?? ""} className="plain w-full" placeholder="support@…" /></Field>
          <Field label="Hours" hint="when someone answers"><input name="hours" defaultValue={platform.SUPPORT_HOURS ?? ""} className="plain w-full" placeholder="Monday–Friday, 9:00–18:00 (Casablanca)" /></Field>
          <Field label="Telephone" hint="optional"><input name="phone" defaultValue={platform.SUPPORT_PHONE ?? ""} className="plain w-full" /></Field>
        </ActionForm>
      </Sheet>
      <Sheet title="Adding someone" said="on the server">
        <p className="px-5 py-4 text-[13px] leading-6 text-slate-700 sm:px-6">
          Run <code className="font-mono">create-operator &lt;email&gt; &lt;name&gt;</code> with the password in <code className="font-mono">DELIOS_OPERATOR_PASSWORD</code>{" "}
          (14 characters or more). Their first sign-in shows a QR code to scan with an authenticator app, then gives recovery codes once. Run again for the same email (a lost phone): a new password, and the authenticator set up again.
        </p>
      </Sheet>
    </>
  );
}
