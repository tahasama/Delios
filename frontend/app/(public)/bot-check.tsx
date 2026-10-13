"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";

type Turnstile = {
  render: (element: HTMLElement, options: { sitekey: string; "response-field-name"?: string }) => string;
  reset: (widget: string) => void;
  remove: (widget: string) => void;
};

declare global {
  interface Window { turnstile?: Turnstile }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * The check that a person, not a script, is filling the form in (Cloudflare Turnstile). It puts its token in the
 * form as `cf-turnstile-response`; the backend checks it once. Shown only where the installation has a site key.
 * `renew` changes after each answer, so a token already spent is replaced before the next try.
 */
export function BotCheck({ renew }: { renew?: unknown }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  const draw = () => {
    if (!SITE_KEY || !box.current || !window.turnstile || widget.current) return;
    widget.current = window.turnstile.render(box.current, { sitekey: SITE_KEY });
  };

  useEffect(() => {
    draw();
    return () => {
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, []);

  useEffect(() => {
    if (renew !== undefined && widget.current && window.turnstile) window.turnstile.reset(widget.current);
  }, [renew]);

  if (!SITE_KEY) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={draw} />
      <div ref={box} />
    </>
  );
}
