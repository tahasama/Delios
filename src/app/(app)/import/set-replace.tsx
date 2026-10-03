"use client";

import { useState } from "react";
import { inputCls } from "@/components/ui";
import { SetUpload } from "../admin/config/set-upload";

/**
 * Replacing a published list from a spreadsheet, for any of them.
 *
 * It used to sit on one set's own page, which meant doing it to five lists was
 * five journeys. Choosing the list here is the only thing this adds; the
 * preview and apply are the same ones the set page used.
 */
export function SetReplace({ sets }: { sets: { key: string; title: string; count: number }[] }) {
  const [setKey, setSetKey] = useState(sets[0]?.key ?? "");
  if (!sets.length) return null;

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-700">Which list</span>
        <select value={setKey} onChange={(event) => setSetKey(event.target.value)} className={inputCls}>
          {sets.map((one) => (
            <option key={one.key} value={one.key}>{one.title} ({one.count})</option>
          ))}
        </select>
      </label>
      <SetUpload key={setKey} setKey={setKey} templateHref={`/api/controlled/current/VALUE_SET?key=${encodeURIComponent(setKey)}`} />
    </div>
  );
}
