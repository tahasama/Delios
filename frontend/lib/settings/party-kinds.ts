/**
 * How an organization works with us. Shared by the server page that lists
 * parties and the client control that edits one, so both say it the same way.
 */
export const PARTY_KINDS: { value: string; label: string; hint: string }[] = [
  { value: "COLLABORATOR", label: "Collaborator", hint: "they have their own DELIOS: their people work here with their own accounts" },
  { value: "GUEST", label: "Guest", hint: "accounts we make for their people, for the work" },
  { value: "OFFLINE", label: "Not on DELIOS", hint: "nobody of theirs signs in: one of ours records for them, with proof" },
];
