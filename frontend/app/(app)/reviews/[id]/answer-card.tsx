"use client";

import { useState } from "react";

/**
 * Where a step is answered. The holder either answers it or hands it on, so
 * the card shows one or the other: Delegate, top right, swaps the verdict for
 * the hand-over form, and the button there then brings the verdict back.
 */
export function AnswerCard({ title, answerLabel, delegate, children }: {
  title: string;
  /** What the button that brings the answer back says ("Give my verdict"). */
  answerLabel: string;
  /** The hand-over form, when this person may hand the step on. */
  delegate?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [handing, setHanding] = useState(false);
  const showing = handing && delegate;
  return (
    <section className="register register-sheet">
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line bg-tint-soft px-5 py-2 sm:px-6">
        <h2 className="stencil shrink-0 text-slate-500">{showing ? "Hand it to somebody else" : title}</h2>
        {delegate ? (
          <button
            type="button"
            onClick={() => setHanding((now) => !now)}
            data-on={showing ? "true" : undefined}
            className="ask ml-auto py-1! text-xs!"
          >
            {showing ? answerLabel : "Delegate"}
          </button>
        ) : null}
      </header>
      <div className="px-5 py-4 sm:px-6">
        {/* Both stay mounted, so a half-filled verdict survives a look at the other. */}
        <div hidden={!!showing}>{children}</div>
        {delegate ? <div hidden={!showing}>{delegate}</div> : null}
      </div>
    </section>
  );
}
