import "server-only";
import { api } from "@/lib/client";

/** The legal texts, read by anyone (backend `/api/legal`). Version 0: the text DELIOS starts from, not published yet. */
export type LegalListed = { kind: string; slug: string; title: string; lead: string; accepted: boolean; version: number; publishedAt: string | null };
export type LegalText = { kind: string; slug: string; title: string; lead: string; version: number; publishedAt: string | null; body: string; note: string | null; placeholder: boolean };

export const legalTexts = () => api<LegalListed[]>("/api/legal");
export const legalText = (slug: string) => api<LegalText>(`/api/legal/${encodeURIComponent(slug)}`);
