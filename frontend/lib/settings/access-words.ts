/**
 * What holding a function lets someone do, in plain words, for the invitation written when someone is asked to join
 * (owner: "this is an invitation to project x, from now on you have access to y, w, z"). Plain module: read by pages.
 */
const WORDS: [string, string][] = [
  ["READ", "reading its documents"],
  ["CREATE", "registering documents"],
  ["REVISE", "revising them"],
  ["REVIEW", "reviewing"],
  ["APPROVE", "approving"],
  ["TRANSMIT", "sending transmittals"],
  ["RECEIVE", "receiving what is sent to you"],
  ["ACCEPT", "checking what arrives"],
  ["CONTROL", "controlling the register"],
  ["PLAN", "uploading the schedule"],
  ["MANAGE", "confirming requests"],
  ["CONFIGURE", "setting it up"],
];

/** The verbs a function holds anywhere, as one sentence ("reading its documents, reviewing and approving"). */
export function accessWords(verbs: Iterable<string>): string {
  const held = new Set(verbs);
  const said = WORDS.filter(([verb]) => held.has(verb)).map(([, words]) => words);
  return said.length <= 1 ? said.join("") : `${said.slice(0, -1).join(", ")} and ${said.at(-1)}`;
}
