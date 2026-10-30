"use client";

import { useEffect } from "react";
import { reportError } from "./report-error";

/** Mounted once: what fails outside React's own error pages (a click handler, a promise nobody awaited) is reported too. */
export function ErrorWatch() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportError(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => reportError(event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
