/**
 * The side colours: one per state, never shared by two things that mean different things; states that are close
 * (released and accepted, done and ready) take close colours. The classes are in `app/globals.css` (`.rail-*`); this
 * list is the key shown on Help, "What the colours say". Add a state here and in the CSS together.
 */
export const RAILS = [
  { area: "Documents", items: [
    { rail: "rail-none", name: "No revision yet" },
    { rail: "rail-prep", name: "Being prepared" },
    { rail: "rail-review", name: "In review" },
    { rail: "rail-released", name: "Released" },
    { rail: "rail-superseded", name: "Superseded by a newer revision" },
    { rail: "rail-void", name: "Void" },
  ] },
  { area: "Reviews", items: [
    { rail: "rail-review", name: "Open, in time" },
    { rail: "rail-risk", name: "Open, at risk" },
    { rail: "rail-overdue", name: "Open, overdue" },
    { rail: "rail-accepted", name: "Decided: accepted" },
    { rail: "rail-rejected", name: "Decided: rejected" },
    { rail: "rail-withdrawn", name: "Withdrawn" },
  ] },
  { area: "Transmittals", items: [
    { rail: "rail-draft", name: "Draft, not sent" },
    { rail: "rail-sent", name: "Sent" },
    { rail: "rail-check", name: "Received, to check" },
    { rail: "rail-accepted", name: "Accepted by the check" },
    { rail: "rail-returned", name: "Returned to whoever sent it" },
    { rail: "rail-received", name: "Received, words alone" },
  ] },
  { area: "Schedule", items: [
    { rail: "rail-done", name: "Done, with its documents" },
    { rail: "rail-ready", name: "Ready, still ahead" },
    { rail: "rail-ahead", name: "Still ahead" },
    { rail: "rail-risk", name: "At risk" },
    { rail: "rail-overdue", name: "Overdue" },
    { rail: "rail-late", name: "Late receipt: the documents came after the work" },
    { rail: "rail-none", name: "Nothing listed" },
  ] },
  { area: "Supplier documents", items: [
    { rail: "rail-none", name: "Not sent to the supplier yet" },
    { rail: "rail-sent", name: "Sent to the supplier" },
    { rail: "rail-check", name: "Received, to check" },
    { rail: "rail-accepted", name: "Accepted by the check" },
    { rail: "rail-returned", name: "Returned by the check, to correct" },
    { rail: "rail-review", name: "In review" },
    { rail: "rail-released", name: "Released" },
    { rail: "rail-rejected", name: "Returned by the review, to revise" },
  ] },
  { area: "Delivery package documents", items: [
    { rail: "rail-ready", name: "Ready at the status it needs" },
    { rail: "rail-shortfall", name: "Released, not at that status yet" },
    { rail: "rail-none", name: "Nothing released yet" },
  ] },
  { area: "Packages", items: [
    { rail: "rail-ahead", name: "Being put together" },
    { rail: "rail-shortfall", name: "Something missing" },
    { rail: "rail-delivered", name: "Delivered, to accept" },
    { rail: "rail-done", name: "Accepted" },
  ] },
] as const;
