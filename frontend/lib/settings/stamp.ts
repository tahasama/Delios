/**
 * The stamp (owner: "an engagement that legally holds"), a Settings card of its own at both levels: the organization's
 * answers are every project's default, a project's own stand over them where the organization leaves it free
 * (switch POLICY_PDF_STAMP). Plain data, read by the screens and the server alike; the backend reads the same keys
 * (`Stamping.StampChoices`).
 */

/** Stamped at all: on unless switched off. */
export const STAMP_ON_KEY = "POLICY_PDF_STAMP";

/** When a review stamps the PDF: released after it, and returned by it (each on unless off). */
export const STAMP_WHEN = [
  { key: "STAMP:RELEASED", label: "Released after its review", text: "the revision a review released", on: true },
  { key: "STAMP:RETURNED", label: "Returned by its review", text: "the revision a review sent back: the same stamp, its grade ticked", on: true },
] as const;

/**
 * What the stamp shows besides what it always carries: one design whatever the outcome (owner: "the stamp is unified"),
 * as review stamps are drawn (vendor documents, shop drawings): the organization and "Document review" with the project,
 * every grade the review could give with its box, the one given ticked, who reviewed it and when.
 */
export const STAMP_SHOWS = [
  { key: "STAMP_SHOW:STEPS", label: "Every grade given", text: "each step of the route: its grade (advice or verdict), who gave it and when", on: true },
  { key: "STAMP_SHOW:STATUS", label: "What it is released for", text: "the status the decider granted", on: false },
  { key: "STAMP_SHOW:DOCUMENT", label: "The document and its revision", text: "its number and revision", on: false },
  { key: "STAMP_SHOW:REVIEW", label: "The review", text: "the review's number, to find it in the app", on: false },
] as const;
export const STAMP_COMMENTS_KEY = "STAMP_COMMENTS";
export const STAMP_PLACE_KEY = "STAMP_PLACE";
/** The organization's words at the stamp's foot (what the review does not relieve the sender of…): none unless written. */
export const STAMP_NOTE_KEY = "STAMP_NOTE";
export const STAMP_NOTE_MAX = 240;
export const STAMP_PLACES = [
  { value: "TOP_RIGHT", label: "Top right" },
  { value: "TOP_LEFT", label: "Top left" },
  { value: "BOTTOM_RIGHT", label: "Bottom right" },
  { value: "BOTTOM_LEFT", label: "Bottom left" },
] as const;

/**
 * The marks across the page, kept as they were (owner): superseded once a later revision is released, void, on hold.
 * Each on unless switched off.
 */
export const STAMP_KINDS = [
  { key: "STAMP:SUPERSEDED", label: "Superseded", text: "across the page, once a later revision is released" },
  { key: "STAMP:VOID", label: "Void", text: "across the page, with why" },
  { key: "STAMP:HELD", label: "On hold", text: "across the page, while it is not for use" },
] as const;

/** Every key of the card, in the order it is saved. */
export const STAMP_KEYS = [STAMP_ON_KEY, ...STAMP_WHEN.map((one) => one.key), ...STAMP_SHOWS.map((one) => one.key),
  STAMP_COMMENTS_KEY, STAMP_PLACE_KEY, STAMP_NOTE_KEY, ...STAMP_KINDS.map((one) => one.key)];

/** The app's own answer to one key of the stamp. */
export function stampDefault(key: string): string {
  if (key === STAMP_PLACE_KEY) return "TOP_RIGHT";
  if (key === STAMP_NOTE_KEY) return "";
  if (key === STAMP_COMMENTS_KEY) return "OFF";
  const flagged = [...STAMP_WHEN, ...STAMP_SHOWS].find((one) => one.key === key);
  if (flagged) return flagged.on ? "ON" : "OFF";
  return "ON";
}

/** What stands for one key: the project's own, else the organization's, else the app's. */
export type StampAnswers = Record<string, string>;
export function stampAnswers(organization: Map<string, string>, project?: Map<string, string>): StampAnswers {
  return Object.fromEntries(STAMP_KEYS.map((key) => [key, project?.get(key) ?? organization.get(key) ?? stampDefault(key)]));
}

/** Whether the project keeps answers of its own about the stamp. */
export function stampOwn(project: Map<string, string>): boolean {
  return STAMP_KEYS.some((key) => project.has(key));
}

/** The stamp in one sentence, for whoever reads it (the Control room, the plan). */
export function stampSaid(a: StampAnswers): string {
  if (a[STAMP_ON_KEY] === "OFF") return "No PDF is stamped; where it stands is read in the app.";
  const when = STAMP_WHEN.filter((one) => a[one.key] === "ON").map((one) => one.label.toLowerCase());
  const shows = STAMP_SHOWS.filter((one) => a[one.key] === "ON").map((one) => one.label.charAt(0).toLowerCase() + one.label.slice(1));
  const place = STAMP_PLACES.find((one) => one.value === a[STAMP_PLACE_KEY])?.label.toLowerCase() ?? "top right";
  const marks = STAMP_KINDS.filter((one) => a[one.key] !== "OFF").map((one) => one.label.toLowerCase());
  return `${when.length ? `Stamped when ${when.join(", or ")}, ${place}: one review stamp, every grade the review could give with the one given ticked, who reviewed it and when${shows.length ? `, ${shows.join(", ")}` : ""}${a[STAMP_COMMENTS_KEY] === "ON" ? ", and why on a last page" : ""}.` : "No review stamps the PDF."}${marks.length ? ` Marked across the page: ${marks.join(", ")}.` : ""}`;
}
