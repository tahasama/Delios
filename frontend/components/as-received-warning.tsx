import { Banner } from "@/components/ui";

/**
 * What taking documents as they come does to the register (a project with no placeholders, the Control room), said the same
 * wherever it shows: the package, the transmittal that brings them, each document taken so, the Control room.
 */
export const AS_RECEIVED_RISKS = [
  ["Numbering", "their numbers sit in our register beside ours; our numbering no longer says what a number is made of."],
  ["Revisions", "their revision values, outside our revision scheme; we cannot start a revision of our own on them."],
  ["States and review outcomes", "their words, as they gave them; nothing of ours checked them, and our review starts from nothing."],
  ["Search and reports", "the same kind of document reads under two ways of naming; filters and counts across them can mislead."],
  ["Archiving and keeping", "kept under the deliverable type chosen in the Control room, not under rules made for them; check before archiving or disposing."],
] as const;

export function AsReceivedWarning({ who, short = false }: { who?: string; short?: boolean }) {
  return (
    <Banner tone="danger" title={`Taken as ${who ? `${who} sends them` : "they come"}: the register is no longer consistent`}>
      {short ? (
        <>Its number, revision, status and review outcome are {who ?? "the sender"}&rsquo;s, not ours: our numbering, revisions and states do not apply to it.</>
      ) : (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {AS_RECEIVED_RISKS.map(([what, why]) => <li key={what}><span className="font-semibold">{what}:</span> {why}</li>)}
        </ul>
      )}
    </Banner>
  );
}
