// Annex G routes — the execution checklists (Layer II), rendered live in the UI.
// Each step cites its Rule; digital use records Route ID, step, actor, timestamp.

export type RouteStep = { id: string; text: string; clause: string };

export const ROUTES: Record<string, { id: string; title: string; steps: RouteStep[] }> = {
  G1: {
    id: "G.1",
    title: "Creating a new document",
    steps: [
      { id: "1", text: "Confirm it is controlled information — if not, mark uncontrolled and stop", clause: "§2.1" },
      { id: "2", text: "Confirm whether it is a document or a record", clause: "§2.2" },
      { id: "3", text: "Obtain a document number — from the system, or from a range issued by the control function", clause: "§3.7" },
      { id: "4", text: "Create the register entry", clause: "§16.8 · §3.9" },
      { id: "5", text: "Assign deliverable type, document type, discipline and confidentiality", clause: "§5.2 · §5.7" },
      { id: "6", text: "Record core metadata", clause: "§4.3" },
      { id: "7", text: "Associate it with the equipment, action or package it relates to", clause: "§5.8 · 14 · 15" },
      { id: "8", text: "Prepare the content; working iterations are versions, outside this Standard", clause: "§6.1" },
      { id: "9", text: "Submit for review, or for approval where no review applies", clause: "§9.1" },
      { id: "10", text: "Obtain approval from the authority holding it for this class", clause: "§8.2 · §8.3" },
      { id: "11", text: "Confirm metadata is complete", clause: "§4.8" },
      { id: "12", text: "Release at a status", clause: "§7.6" },
      { id: "13", text: "Produce the rendition", clause: "§10.2" },
    ],
  },
  G2: {
    id: "G.2",
    title: "Sending information to an external party",
    steps: [
      { id: "1", text: "Confirm the revision is released — nothing else may be issued", clause: "§11.3" },
      { id: "2", text: "Determine the reason for issue", clause: "§2.6" },
      { id: "3", text: "Confirm the status carries the maturity that reason requires", clause: "§2.6 · §7.8" },
      { id: "4", text: "Identify recipients from the defined distribution", clause: "§11.8" },
      { id: "5", text: "Request the transmittal from the control function", clause: "§11.13" },
      { id: "6", text: "The control function raises the transmittal and records its content", clause: "§11.1" },
      { id: "7", text: "Record whether a response is required and the period for it", clause: "§11.12" },
      { id: "8", text: "Issue", clause: "§11.1" },
      { id: "9", text: "Record receipt where a consequence follows from it", clause: "§11.5" },
    ],
  },
  G3: {
    id: "G.3",
    title: "Revising an existing document",
    steps: [
      { id: "1", text: "Establish the reason; a review outcome requiring resubmission is itself the reason", clause: "§6.5 · §9.3" },
      { id: "2", text: "Obtain authorization before the revision is established or a revision value assigned", clause: "§6.5" },
      { id: "3", text: "Confirm no other revision of the same document is in preparation", clause: "§6.3" },
      { id: "4", text: "Take the next value in the applicable series", clause: "§6.2 · §6.3" },
      { id: "5", text: "Record the reason and describe what changed", clause: "§6.6" },
      { id: "6", text: "Submit, review, approve and release as for a new document", clause: "§9 · §8 · §7.5" },
      { id: "7", text: "On release, the earlier revision becomes superseded", clause: "§7.5" },
      { id: "8", text: "Notify everyone who received the superseded revision", clause: "§12.3" },
      { id: "9", text: "Recall, replace or mark any registered copies", clause: "§12.4" },
    ],
  },
  G4: {
    id: "G.4",
    title: "Responding to a review",
    steps: [
      { id: "1", text: "Receive the outcome, comments and revision authorization from the control function", clause: "§9.8 · §11.7" },
      { id: "2", text: "Identify which comments prevent progression", clause: "§9.6" },
      { id: "3", text: "If any prevent progression, work does not proceed — irrespective of the outcome given", clause: "§9.6" },
      { id: "4", text: "If a comment is misclassified, have it reclassified", clause: "§9.6" },
      { id: "5", text: "Respond to each progression-preventing comment with how it was resolved", clause: "§9.6" },
      { id: "6", text: "Where the outcome requires resubmission, revise per G.3", clause: "§9.3" },
      { id: "7", text: "Where it does not, record it and close the cycle", clause: "§9.4" },
    ],
  },
  G5: {
    id: "G.5",
    title: "Receiving information from an external party",
    steps: [
      { id: "1", text: "Record receipt with the date and the receiving party", clause: "§11.5" },
      { id: "2", text: "Check the transmittal against the published acceptance conditions", clause: "§11.9" },
      { id: "3", text: "If it fails, record the rejection with its reason and notify the issuing party", clause: "§11.9" },
      { id: "4", text: "Apply the published consequence of rejection; do not decide it case by case", clause: "§11.10" },
      { id: "5", text: "If it passes, record acceptance; response periods run from this point", clause: "§11.12" },
      { id: "6", text: "Confirm metadata mandatory for that deliverable type is complete", clause: "§4.4 · §5.2" },
      { id: "7", text: "Where the reason requires review, open one cycle per revision carried", clause: "§11.11 · §9.1" },
      { id: "8", text: "Where it does not, the transmittal is complete on acceptance", clause: "§11.11" },
    ],
  },
  G6: {
    id: "G.6",
    title: "Taking a document out of use",
    steps: [
      { id: "1", text: "Establish which end state applies: superseded, withdrawn, cancelled or void", clause: "§12.1" },
      { id: "2", text: "Replacement exists and was valid until replaced → superseded", clause: "§12.1" },
      { id: "3", text: "Use shall stop before a replacement exists → withdraw it", clause: "§7.5 · §12.1" },
      { id: "4", text: "Issued in error and never valid → void it, by the authority that approved it", clause: "§7.2 · §12.1" },
      { id: "5", text: "Record the state with the date and the authority responsible", clause: "§12.1" },
      { id: "6", text: "Notify every party recorded as having received it", clause: "§12.3" },
      { id: "7", text: "Recall, replace or mark every registered copy, and record the action", clause: "§12.4" },
      { id: "8", text: "Where a revision was voided, reassess work performed under it", clause: "§12.6" },
      { id: "9", text: "Mark retained obsolete information and exclude it from ordinary search", clause: "§12.5" },
    ],
  },
  G7: {
    id: "G.7",
    title: "Closing a package",
    steps: [
      { id: "1", text: "At the completion date, assess each member against the required status", clause: "§15.6" },
      { id: "2", text: "The date triggers assessment; it does not close the package", clause: "§15.6" },
      { id: "3", text: "Where members are short, record current status, reason, and expected date", clause: "§15.7" },
      { id: "4", text: "Issue the shortfall record to the acceptance authority", clause: "§15.7" },
      { id: "5", text: "Decide whether to issue it to the recipient", clause: "§15.7" },
      { id: "6", text: "Where a shortfall is accepted, record the acceptance and its authority", clause: "§15.8" },
      { id: "7", text: "Accumulated package: state that the membership rule has ceased to admit members", clause: "§15.8" },
      { id: "8", text: "Declare closure", clause: "§15.8" },
    ],
  },
};

export function RouteChecklist({
  routeKey,
  doneUpTo,
  doneIds,
  compact,
}: {
  routeKey: keyof typeof ROUTES | string;
  /** number of steps from the start that are already satisfied */
  doneUpTo?: number;
  /** explicit set of satisfied step ids (overrides doneUpTo) */
  doneIds?: string[];
  compact?: boolean;
}) {
  const route = ROUTES[routeKey];
  if (!route) return null;
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50">
      <div className="border-b border-emerald-200 px-4 py-2.5">
        <p className="text-xs font-semibold text-emerald-900">Route {route.id} · {route.title}</p>
        <p className="text-[11px] text-emerald-700/80">Layer II — the standard&apos;s execution checklist. Steps are recorded as you go.</p>
      </div>
      <ol className="divide-y divide-emerald-100">
        {route.steps.map((step, i) => {
          const done = doneIds ? doneIds.includes(step.id) : doneUpTo != null && i < doneUpTo;
          return (
            <li key={step.id} className={`flex items-start gap-2.5 px-4 ${compact ? "py-1.5" : "py-2"}`}>
              <span
                className={`mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                  done ? "bg-emerald-500 text-white" : "bg-white text-emerald-700 ring-1 ring-emerald-300"
                }`}
              >
                {done ? "✓" : step.id}
              </span>
              <p className={`text-xs leading-snug ${done ? "text-emerald-800" : "text-slate-600"}`}>
                {step.text} <span className="font-mono text-[10px] text-emerald-600/70">{step.clause}</span>
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
