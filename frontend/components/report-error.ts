"use client";

// Tells us what failed in the browser (owner, "error tracking"): the message, where it came from in the code and the
// page's address, never what the page showed. Sent once per error and at most 10 times per page, without waiting.
const sent = new Set<string>();

export function reportError(error: unknown) {
  const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");
  const key = `${e.message}\n${(e as { digest?: string }).digest ?? ""}`;
  if (sent.has(key) || sent.size >= 10) return;
  sent.add(key);
  try {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        message: e.message, digest: (e as { digest?: string }).digest ?? null, stack: e.stack ?? null,
        // The address without its query: what someone searched or filtered on stays theirs.
        page: window.location.pathname,
      }),
    }).catch(() => undefined);
  } catch {
    // Reporting never breaks the page further.
  }
}
