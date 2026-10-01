"use client";

import { useEffect, useRef, useState } from "react";

/**
 * What the Send button will carry, said before it is pressed: how many of the
 * documents waiting on the supplier have a file attached, and how many stay
 * with them. Counts the file inputs of the form it sits in.
 */
export function FileTally({ waiting }: { waiting: number }) {
  const here = useRef<HTMLParagraphElement>(null);
  const [attached, setAttached] = useState(0);
  useEffect(() => {
    const form = here.current?.closest("form");
    if (!form) return;
    const count = () => setAttached([...form.querySelectorAll<HTMLInputElement>('input[type="file"]')].filter((one) => one.files?.length).length);
    form.addEventListener("change", count);
    return () => form.removeEventListener("change", count);
  }, []);
  const left = waiting - attached;
  return (
    <p ref={here} className="text-[12px] text-slate-600">
      {attached
        ? <><strong className="text-slate-800">{attached}</strong> of {waiting} ready to send{left ? <> · <span className="text-amber-700">{left} still without a file</span></> : " · nothing left out"}</>
        : <>{waiting} document{waiting === 1 ? "" : "s"} waiting on you — attach a file next to each one you are sending.</>}
    </p>
  );
}
