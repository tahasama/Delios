/**
 * How an organization works with us. Shared by the server page that lists
 * parties and the client control that edits one, so both say it the same way.
 */
export const PARTY_KINDS: { value: string; label: string; hint: string }[] = [
  { value: "COLLABORATOR", label: "Collaborator", hint: "they run this EDMS with us, and answer here" },
  { value: "GUEST", label: "Guest", hint: "an account here, only to do a task on this project" },
  { value: "OFFLINE", label: "Not on the EDMS", hint: "no account — our people fill in for them, with proof" },
];
