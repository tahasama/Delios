/**
 * How an organization works with us. Shared by the server page that lists
 * parties and the client control that edits one, so both say it the same way.
 */
export const PARTY_KINDS: { value: string; label: string; hint: string }[] = [
  { value: "COLLABORATOR", label: "Works from its own DELIOS", hint: "its people work here with their own accounts" },
  { value: "GUEST", label: "We give its people accounts", hint: "accounts we make for them, for this work" },
  { value: "OFFLINE", label: "One of ours works for it", hint: "nobody of theirs signs in: one of ours sends to them and records their answers, with proof" },
];
