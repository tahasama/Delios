import { Fragment } from "react";
import { Scale } from "lucide-react";

/**
 * A legal text as DELIOS publishes it: "## " a heading, "- " a line of a list, anything else a paragraph. What only a
 * lawyer may write is marked `[[LAWYER: …]]` and drawn in red, labelled so (owner: "mark in red that this should be a
 * legal thing"), wherever the text shows: the public pages, the console, an organization's Contract & plan.
 */
export function LegalText({ body }: { body: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length} className="text-[13px] leading-6 text-slate-700">{inline(para.join(" "))}</p>);
    if (list.length) blocks.push(
      <ul key={blocks.length} className="list-disc space-y-1 pl-5 text-[13px] leading-6 text-slate-700">{list.map((one, i) => <li key={i}>{inline(one)}</li>)}</ul>,
    );
    para = [];
    list = [];
  };
  for (const raw of joinLawyerLines(body).split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith("## ")) {
      flush();
      blocks.push(<h2 key={blocks.length} className="mt-2 text-sm font-semibold text-slate-900">{line.slice(3)}</h2>);
    } else if (line.startsWith("- ")) {
      if (para.length) { const keep = list; list = []; flush(); list = keep; }
      list.push(line.slice(2));
    } else {
      if (list.length) { const keep = para; para = []; flush(); para = keep; }
      para.push(line);
    }
  }
  flush();
  return <div className="space-y-3">{blocks}</div>;
}

/** A lawyer's part may run over several lines: kept as one. */
function joinLawyerLines(body: string): string {
  return body.replace(/\[\[LAWYER:([\s\S]*?)\]\]/g, (_, inside: string) => `[[LAWYER:${inside.replace(/\s*\n\s*/g, " ")}]]`);
}

function inline(text: string): React.ReactNode {
  const parts = text.split(/(\[\[LAWYER:[\s\S]*?\]\])/g);
  return parts.map((part, i) => {
    const m = /^\[\[LAWYER:([\s\S]*?)\]\]$/.exec(part);
    if (!m) return <Fragment key={i}>{part}</Fragment>;
    return (
      <span key={i} className="my-0.5 inline-flex items-start gap-1.5 rounded-sm border border-dashed border-red-400 bg-red-50 px-1.5 py-0.5 text-red-800 dark:bg-red-950/40 dark:text-red-200">
        <Scale className="mt-1 h-3 w-3 shrink-0" aria-hidden="true" />
        <span><strong className="font-semibold">For a lawyer:</strong> {m[1].trim()}</span>
      </span>
    );
  });
}

/** How many parts are still a lawyer's to write. */
export const lawyerParts = (body: string) => (body.match(/\[\[LAWYER:/g) ?? []).length;
