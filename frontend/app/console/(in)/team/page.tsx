import { consoleApi } from "@/lib/console/client";
import { cn, fmtDate, fmtDateTime } from "@/lib/core/utils";
import { ActionForm } from "@/components/form";
import { Field } from "@/components/ui";
import { setOperatorActiveAction } from "@/lib/console/forms";
import { Plate, Sheet } from "../parts";

export const metadata = { title: "Team" };

type Member = { id: string; name: string; email: string; active: boolean; createdAt: string; lastSignInAt: string | null; locked: string | null };

/** Who runs DELIOS. Added on the server only, never from a page, each with two-step sign-in. */
export default async function Team() {
  const team = await consoleApi<Member[]>("/api/console/team");
  return (
    <>
      <Plate title="Team & support" meta="The people who run DELIOS. Their accounts open the console only, never an organization's space." />
      <Sheet title="Everyone" said={`${team.length}`}>
        <ul className="divide-y divide-line">
          {team.map((m) => (
            <li key={m.id} className={cn("px-5 py-3 text-[13px] sm:px-6", !m.active && "opacity-60")}>
              <span className="font-medium text-slate-900">{m.name}</span> <span className="text-slate-500">{m.email}</span>
              <span className="block text-[11px] text-slate-500">since {fmtDate(m.createdAt)} · last signed in {fmtDateTime(m.lastSignInAt)}{m.locked && new Date(m.locked) > new Date() ? " · locked for a few minutes" : ""}{m.active ? "" : " · switched off"}</span>
              {/* Someone who left the team (owner): switched off here, with why; never one's own, never the last. */}
              <details className="mt-1.5">
                <summary className="ask cursor-pointer list-none">{m.active ? "Switch off" : "Switch on"}</summary>
                <ActionForm action={setOperatorActiveAction} hidden={{ operatorId: m.id, active: m.active ? "false" : "true" }}
                  submitLabel={m.active ? "Switch off" : "Switch on"} variant={m.active ? "danger" : "primary"}
                  confirmText={m.active ? `${m.name} will no longer sign in to the console; their sessions end now.` : undefined} className="asking mt-2 max-w-md space-y-3">
                  <Field label="Why" required><input name="why" required className="plain w-full" /></Field>
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>
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
