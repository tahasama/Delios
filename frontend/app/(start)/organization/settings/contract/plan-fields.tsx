"use client";

import { useState } from "react";
import { Field } from "@/components/ui";
import { Select } from "@/components/select";

type PlanOffer = { code: string; name: string; pricePerUser: number | null; currency: string; notes: string | null };

const money = (v: number, c: string) => `${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

/**
 * The plan and how many users, with what it comes to, worked out as they are chosen (owner: the price is seen before the
 * choice is sent): users × the plan's price a month, before tax; a plan priced on request says so.
 */
export function PlanFields({ plans, plan, users, today }: { plans: PlanOffer[]; plan: string; users: number; today: number }) {
  const [chosen, setChosen] = useState(plan);
  const [count, setCount] = useState(users);
  const offer = plans.find((p) => p.code === chosen);
  return (
    <>
      <Field label="Plan" required>
        <Select name="plan" required value={chosen} onChange={(e) => setChosen(e.target.value)} className="plain w-full">
          {plans.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name} · {p.pricePerUser == null ? "price on request" : `${p.pricePerUser} ${p.currency} per user a month`}{p.notes ? ` · ${p.notes}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Users" required hint={`${today} today`}>
        <input name="users" type="number" min={1} required value={count} onChange={(e) => setCount(Math.max(0, Number(e.target.value) || 0))} className="plain w-full" />
      </Field>
      <p className="text-[13px] text-slate-700 sm:col-span-2" aria-live="polite">
        {offer?.pricePerUser == null
          ? "This plan is priced on request: DELIOS answers with its price before any invoice."
          : <>It comes to <strong className="text-slate-900">{money(offer.pricePerUser * count, offer.currency)} a month</strong>, before tax ({count} user{count === 1 ? "" : "s"} × {money(offer.pricePerUser, offer.currency)}); {money(offer.pricePerUser * count * 12, offer.currency)} a year.</>}
      </p>
    </>
  );
}
