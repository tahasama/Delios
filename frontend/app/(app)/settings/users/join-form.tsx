"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, UserPlus } from "lucide-react";
import { ActionForm } from "@/components/form";
import { SearchPick, type PickItem } from "@/components/search-pick";
import { Field } from "@/components/ui";
import { NewPerson, WhoConfirms, FunctionAndDepartment } from "./new-person";
import { askToJoinAction } from "@/lib/settings/forms-people";

type Option = { value: string; label: string };

/** A field as on the new-document form: grey, no box, inside the sheet's `asking` body. */
const field = "plain w-full";

/**
 * "Someone joins <project>": one sheet, the new-document form's way, never a sheet inside a sheet. Closed, its band
 * and the acts ("Add someone", "Ask for someone to join"); one chosen, the same sheet becomes that form: its band names
 * it, grey fields side by side, then the strip with Cancel on the left and the act on the right.
 */
export function SomeoneJoins({
  projectCode, sentence, mayAdd, people, ourParties, guestParties, functions, disciplines, confirmers, asks, mayKeepProof, footnote,
}: {
  projectCode: string;
  /** The band's sentence while nothing is chosen. */
  sentence: string;
  /** "Add someone" with an account is offered. */
  mayAdd: boolean;
  /** People with an account who are not on the project yet. */
  people: PickItem[];
  ourParties: Option[];
  /** Guest organizations (accounts we make). */
  guestParties: Option[];
  functions: Option[];
  disciplines: Option[];
  confirmers: PickItem[];
  /** True: it is asked first; false: they are put on at once. */
  asks: boolean;
  /** The control function keeps the email or letter a request came on. */
  mayKeepProof: boolean;
  /** A line under the acts, while nothing is chosen. */
  footnote?: React.ReactNode;
}) {
  const [chosen, setChosen] = useState<"add" | "ask" | null>(null);
  const formId = `someone-joins-${chosen ?? "none"}`;

  const band = (title: string, said: string) => (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
      <span className="stencil mr-1 text-slate-500">{title}</span>
      <span className="text-[11px] text-slate-500">{said}</span>
    </div>
  );

  if (!chosen) {
    return (
      <section id="join" className="register register-sheet register-sheet-open scroll-mt-24" aria-label={`Someone joins ${projectCode}`}>
        {band(`Someone joins ${projectCode}`, sentence)}
        <div className="space-y-3 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-start gap-2">
            {mayAdd ? (
              <button type="button" onClick={() => setChosen("add")} disabled={!people.length} className="ask disabled:cursor-not-allowed disabled:opacity-50"
                title={people.length ? undefined : `Everyone with an account is already on ${projectCode}`}>
                <Search aria-hidden className="h-3.5 w-3.5" /> Add someone
              </button>
            ) : null}
            {/* Asked of someone, it is a request: written on the one transmittal form, everything obvious filled in.
                Put on at once (no confirmation), it is no letter: it stays here. */}
            {asks ? (
              <Link href="/transmittals/new?join=1" className="ask"><UserPlus aria-hidden className="h-3.5 w-3.5" /> Ask for someone to join</Link>
            ) : (
              <button type="button" onClick={() => setChosen("ask")} className="ask"><UserPlus aria-hidden className="h-3.5 w-3.5" /> Ask for someone to join</button>
            )}
          </div>
          {footnote ? <p className="text-[11px] leading-4 text-slate-500">{footnote}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <section id="join" className="register register-sheet register-sheet-open scroll-mt-24" aria-label={chosen === "add" ? "Add someone" : "Ask for someone to join"}>
      {chosen === "add"
        ? band("Add someone", `someone who already has an account, and their place on ${projectCode}`)
        : band("Ask for someone to join", `someone new: their account is made, and their link to choose a password goes once they are on ${projectCode}`)}
      <ActionForm id={formId} action={askToJoinAction} hideSubmit resetOnSuccess className="asking space-y-5 px-5 py-5 sm:px-6">
        {chosen === "add" ? (
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <SearchPick single required name="userId" label="Who" hint="type part of a name" items={people} placeholder="Find someone" />
            {asks ? <WhoConfirms confirmers={confirmers} /> : <span aria-hidden />}
            <FunctionAndDepartment projectCode={projectCode} functions={functions} disciplines={disciplines} />
          </div>
        ) : (
          <>
            <NewPerson projectCode={projectCode} ourParties={ourParties} guestParties={guestParties} functions={functions}
              disciplines={disciplines} mayKeepProof={mayKeepProof} />
            <Field label="Message" hint="optional — whoever answers reads it">
              <textarea name="why" rows={2} className={field} placeholder="e.g. joins the piping team for the detailed design" />
            </Field>
          </>
        )}
      </ActionForm>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-tint-soft px-5 py-3 sm:px-6">
        <button type="button" onClick={() => setChosen(null)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</button>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-500">
            {asks ? "It goes as a request; once confirmed they are put on and told." : "They are put on at once, and told."}
          </span>
          <button type="submit" form={formId} data-on="true" className="ask">
            {asks ? (chosen === "add" ? "Ask to confirm" : "Send the request") : `Put them on ${projectCode}`}
          </button>
        </div>
      </div>
    </section>
  );
}
