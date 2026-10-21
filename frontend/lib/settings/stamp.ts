/** The stamp and the marks across the page: plain data, read by the screens and the server alike. */

/**
 * The marks across the page, kept as they were (owner): superseded once a later revision is released, void, on hold.
 * Each on unless switched off (`STAMP:<kind>`, read by the backend's `StampChoices`).
 */
export const STAMP_KINDS = [
  { key: "STAMP:SUPERSEDED", label: "Superseded", text: "across the page, once a later revision is released" },
  { key: "STAMP:VOID", label: "Void", text: "across the page, with why" },
  { key: "STAMP:HELD", label: "On hold", text: "across the page, while it is not for use" },
] as const;

/**
 * The stamp (owner: "an engagement that legally holds"): one, the same on every document, put on a revision released
 * after it went for review (released without review, nothing to stamp). It always carries RELEASED, the grade that
 * stands, larger (the most severe of the deciders', usually the last's), who gave it and when. The project chooses the
 * rest (`STAMP_SHOW:<what>`), why (`STAMP_COMMENTS`, the comments on a last page) and where it sits (`STAMP_PLACE`).
 */
export const STAMP_SHOWS = [
  { key: "STAMP_SHOW:STEPS", label: "Every grade given", text: "each step of the route: its grade (advice or verdict), who gave it and when", on: true },
  { key: "STAMP_SHOW:STATUS", label: "What it is released for", text: "the status the decider granted", on: false },
  { key: "STAMP_SHOW:DOCUMENT", label: "The document and its revision", text: "its number and revision", on: false },
  { key: "STAMP_SHOW:REVIEW", label: "The review", text: "the review's number, to find it in the app", on: false },
] as const;
export const STAMP_COMMENTS_KEY = "STAMP_COMMENTS";
export const STAMP_PLACE_KEY = "STAMP_PLACE";
export const STAMP_PLACES = [
  { value: "TOP_RIGHT", label: "Top right" },
  { value: "TOP_LEFT", label: "Top left" },
  { value: "BOTTOM_RIGHT", label: "Bottom right" },
  { value: "BOTTOM_LEFT", label: "Bottom left" },
] as const;
