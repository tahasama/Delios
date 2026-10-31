"use client";

import { useEffect, useState } from "react";
import { Check, Download, Loader2, X } from "lucide-react";

/**
 * Every download the app prepares (an export, a list as it stands, a report's Excel) is made in the background (owner:
 * "a parallel work like a loading taking its time and not blocking the app; people should expect big files to take
 * time"): a click on one is taken here, the file is asked for while the person keeps working, and saved once it is
 * ready. A tray in the corner says what is being prepared, and what came of it.
 */
const PREPARED = [/^\/api\/export\//, /^\/api\/register\/export/, /^\/api\/reports\//, /^\/api\/packages\/[^/]+\/list/];

type Job = { id: number; name: string; state: "preparing" | "saved" | "failed"; why?: string };

let next = 1;

/** Asks for a download in the background from code (a button that builds its address first). */
export function startDownload(href: string, label: string) {
  window.dispatchEvent(new CustomEvent("delios:download", { detail: { href, label } }));
}

function prepared(url: URL) {
  return url.origin === window.location.origin && PREPARED.some((one) => one.test(url.pathname));
}

/** The file's own name, as the server gives it. */
function fileName(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) return decodeURIComponent(star[1]);
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1] : fallback;
}

export function Downloads() {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    const change = (id: number, what: Partial<Job>) => setJobs((all) => all.map((one) => (one.id === id ? { ...one, ...what } : one)));

    async function prepare(url: URL, label: string) {
      const id = next++;
      setJobs((all) => [...all, { id, name: label, state: "preparing" }]);
      try {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) {
          const problem = await response.json().catch(() => null) as { error?: string } | null;
          change(id, { state: "failed", why: problem?.error ?? "It could not be prepared." });
          return;
        }
        const name = fileName(response, label);
        const blob = await response.blob();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
        change(id, { state: "saved", name });
        setTimeout(() => setJobs((all) => all.filter((one) => one.id !== id)), 8_000);
      } catch {
        change(id, { state: "failed", why: "The connection was lost before it was ready." });
      }
    }

    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank") return;
      const url = new URL(link.href, window.location.href);
      if (!prepared(url)) return;
      event.preventDefault();
      void prepare(url, (link.getAttribute("aria-label") || link.title || link.textContent || "Download").trim());
    }

    function onSubmit(event: SubmitEvent) {
      const form = event.target as HTMLFormElement | null;
      if (!form || event.defaultPrevented || (form.method || "get").toLowerCase() !== "get") return;
      const url = new URL(form.action, window.location.href);
      if (!prepared(url)) return;
      event.preventDefault();
      const data = new FormData(form, event.submitter ?? undefined);
      for (const [key, value] of data.entries()) if (typeof value === "string") url.searchParams.append(key, value);
      void prepare(url, (event.submitter?.getAttribute("aria-label") || event.submitter?.textContent || "Download").trim());
    }

    function onAsked(event: Event) {
      const { href, label } = (event as CustomEvent<{ href: string; label: string }>).detail;
      void prepare(new URL(href, window.location.href), label);
    }

    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("delios:download", onAsked);
    return () => {
      window.removeEventListener("delios:download", onAsked);
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
    };
  }, []);

  if (!jobs.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] space-y-2" role="status" aria-live="polite">
      {jobs.map((job) => (
        <div key={job.id} className="flex items-start gap-2.5 rounded-md bg-surface px-3 py-2.5 text-xs leading-5 text-slate-700 shadow-lg ring-1 ring-line">
          {job.state === "preparing" ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-brand" />
            : job.state === "saved" ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            : <Download className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-slate-800" title={job.name}>{job.name}</p>
            <p className="text-[11px] text-slate-500">
              {job.state === "preparing" ? "Being prepared: a large file takes time. Keep working, it is saved when ready."
                : job.state === "saved" ? "Ready and saved to your downloads."
                : job.why}
            </p>
          </div>
          {job.state !== "preparing" ? (
            <button type="button" onClick={() => setJobs((all) => all.filter((one) => one.id !== job.id))} title="Close" aria-label="Close"
              className="text-slate-400 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
