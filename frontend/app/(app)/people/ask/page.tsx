import Link from "next/link";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath } from "@/lib/client";
import { getActiveSet } from "@/lib/settings/config";
import { JoinForm } from "@/app/(app)/settings/users/join-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask for someone to join" };

type Options = {
  functions: { id: string; name: string }[];
  ours: { id: string; name: string }[];
  guests: { id: string; name: string }[];
  people: { id: string; name: string; organization: string | null }[];
  confirmers: { id: string; name: string; function: string; manager: boolean }[];
  asks: boolean;
  mayKeepProof: boolean;
};

/**
 * Anyone of ours asks for someone to join the project: someone with an account or someone new. It goes to
 * management as a request (an information transmittal); confirmed, they are put on by themselves and told, and
 * whoever asked reads the answer on the same thread.
 */
export default async function AskToJoinPage() {
  const ctx = await requireScope();
  const { project, user } = ctx;
  if (!user.isInternal) {
    return (
      <section className="register register-sheet register-sheet-open px-5 pt-6 pb-4 sm:px-6">
        <h1 className="plate-title text-slate-950">Ask for someone to join</h1>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">People of {project.code} are added at our organization&rsquo;s request: write to Document Control.</p>
      </section>
    );
  }
  const [options, disciplines] = await Promise.all([
    api<Options>(projectPath(ctx, "/people/join-options")).catch(() => null),
    getActiveSet("DISCIPLINES").then((all) => all.map((one) => ({ value: one.code, label: one.label })).sort((x, y) => x.label.localeCompare(y.label))),
  ]);

  return (
    <div className="space-y-4">
      <section className="register register-sheet register-sheet-open">
        <div className="px-5 pt-6 pb-4 sm:px-6">
          <h1 className="plate-title text-slate-950">Ask for someone to join {project.code}</h1>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            {options?.asks === false
              ? "They are put on at once, and told by notification and email."
              : "It goes to management as a request. Confirmed, they are put on by themselves and told by notification and email; you read the answer on the same thread."}
          </p>
          {!options ? (
            <p role="alert" className="mt-2 w-fit rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-red-200">What is needed to ask could not be read just now. Try again in a moment.</p>
          ) : null}
        </div>
      </section>
      {options ? (
        <section className="register register-sheet register-sheet-open" aria-labelledby="ask-head">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
            <span id="ask-head" className="stencil mr-1 text-slate-500">Who, as what, and why</span>
            <span className="text-[11px] text-slate-500">someone whose company has its own DELIOS is put on by their administrator</span>
          </div>
          <div className="px-5 py-4 sm:px-6">
            <JoinForm
              projectCode={project.code}
              people={options.people.map((p) => ({ id: p.id, name: p.name, detail: p.organization }))}
              ourParties={options.ours.map((p) => ({ value: p.id, label: p.name }))}
              guestParties={options.guests.map((p) => ({ value: p.id, label: p.name }))}
              functions={options.functions.map((f) => ({ value: f.id, label: f.name }))}
              disciplines={disciplines}
              confirmers={options.confirmers.map((c) => ({ id: c.id, name: c.name, detail: c.function, note: c.manager ? "recommended" : null }))}
              asks={options.asks}
              mayKeepProof={options.mayKeepProof}
            />
          </div>
          <p className="border-t border-line px-5 py-2.5 text-xs text-slate-500 sm:px-6">
            Waiting answers are on <Link href="/people/confirm" className="font-semibold text-link hover:underline">People to confirm</Link>.
          </p>
        </section>
      ) : null}
    </div>
  );
}
