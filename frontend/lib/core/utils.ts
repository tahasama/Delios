import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDay } from "@/lib/core/date-format";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** A day as the organization reads it (Settings, How dates read). */
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return formatDay(date);
}

/** A day as the organization reads it, with its time (24 hours). */
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatDay(date)}, ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Stored audit text cites clauses of the Standard ("… allocated (§3.7)."). The
 * record keeps them; people reading the screen do not need them.
 */
export function plain(text: string | null | undefined): string {
 return (text ?? "").replace(/\s*\((?:§|Part |FM-|G\.)[^)]*\)/g, "").replace(/\s*§\d+(?:\.\d+)*/g, "").trim();
}
