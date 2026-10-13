"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing } from "lucide-react";
import { ActionForm } from "@/components/form";
import { btn } from "@/components/ui";
import { subscribePushAction, unsubscribePushAction, setPushGroupsAction } from "@/lib/account/forms-push";

const GROUPS = [
  { key: "REVIEWS", label: "Reviews", text: "a step waiting for you, an answer, a hand-over" },
  { key: "DOCUMENTS", label: "Documents", text: "sent to you, received, released, asked to send" },
  { key: "OTHER", label: "Everything else", text: "the schedule, requests, confirmations, people to confirm" },
];

/** The key a browser subscribes with, as the push service wants it. */
function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function text(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Which browser this is, in words a person recognizes in the list of their devices. */
function deviceName(): string {
  const agent = navigator.userAgent;
  const browser = /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : "Browser";
  const system = /Windows/.test(agent) ? "Windows" : /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iPhone" : /Mac OS/.test(agent) ? "Mac" : /Linux/.test(agent) ? "Linux" : "";
  return system ? `${browser} on ${system}` : browser;
}

/**
 * Pop-up notifications: turned on per browser (the browser asks the person
 * first), and which groups pop up, per person. A notice pops up even when no
 * DELIOS page is open; clicking it opens the page it is about.
 */
export function PushSettings({ publicKey, devices, off }: {
  publicKey: string;
  devices: { endpoint: string; device: string | null; createdAt: string }[];
  off: string[];
}) {
  const [here, setHere] = useState<string | null>(null);
  const [state, setState] = useState<"checking" | "unsupported" | "blocked" | "ready">("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") setState("blocked");
    navigator.serviceWorker.register("/sw.js").then(async (registration) => {
      const current = await registration.pushManager.getSubscription();
      setHere(current?.endpoint ?? null);
      if (Notification.permission !== "denied") setState("ready");
    }).catch(() => setState("unsupported"));
  }, []);

  const turnOn = () => start(async () => {
    setMessage(null);
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState(permission === "denied" ? "blocked" : "ready");
      setMessage("The browser was not allowed to show notifications.");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    const result = await subscribePushAction({
      endpoint: subscription.endpoint, p256dh: text(subscription.getKey("p256dh")), auth: text(subscription.getKey("auth")), device: deviceName(),
    });
    if (result.error) setMessage(result.error);
    else setHere(subscription.endpoint);
  });

  const turnOff = () => start(async () => {
    setMessage(null);
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await unsubscribePushAction(subscription.endpoint);
      await subscription.unsubscribe();
    }
    setHere(null);
  });

  const on = !!here && devices.some((one) => one.endpoint === here);

  return (
    <section className="register register-sheet register-sheet-open">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-tint-soft px-5 py-2.5 sm:px-6">
        <span className="stencil mr-1 text-slate-500">Pop-up notifications</span>
        <span className="text-[11px] text-slate-500">they pop up on this computer or phone even when DELIOS is not open</span>
      </div>
      <div className="space-y-4 px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          {state === "unsupported" ? (
            <p className="text-xs text-slate-600">This browser cannot show them. On an iPhone, add DELIOS to the home screen first, then open it from there.</p>
          ) : state === "blocked" ? (
            <p className="text-xs text-amber-800">This browser blocks notifications from DELIOS. Allow them in the browser&rsquo;s site settings, then come back here.</p>
          ) : on ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800"><BellRing className="h-4 w-4" /> On in this browser</span>
              <button type="button" onClick={turnOff} disabled={pending} className={btn("secondary", "sm")}>{pending ? "Working…" : "Turn off here"}</button>
            </>
          ) : (
            <button type="button" onClick={turnOn} disabled={pending || state === "checking"} className={btn("primary", "sm")}>
              {pending ? "Working…" : "Turn on in this browser"}
            </button>
          )}
          {message ? <span className="text-xs text-red-700">{message}</span> : null}
        </div>
        {devices.length ? (
          <p className="text-[11px] text-slate-500">
            On in: {devices.map((one) => `${one.device ?? "a browser"}${one.endpoint === here ? " (this one)" : ""}`).join(", ")}.
          </p>
        ) : null}

        <ActionForm action={setPushGroupsAction} submitLabel="Save" size="sm" className="space-y-2">
          <p className="text-xs font-semibold text-slate-700">What pops up</p>
          {GROUPS.map((group) => (
            <label key={group.key} className="flex items-start gap-2 text-xs text-slate-700">
              <input type="checkbox" name="on" value={group.key} defaultChecked={!off.includes(group.key)} className="mt-0.5" />
              <span><span className="font-semibold">{group.label}</span> <span className="text-slate-500">· {group.text}</span></span>
            </label>
          ))}
          <p className="text-[11px] text-slate-500">Everything still shows on this page and on Home, popped up or not.</p>
        </ActionForm>
      </div>
    </section>
  );
}
