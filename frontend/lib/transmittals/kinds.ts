/**
 * The kinds of transmittal, and how each names its types. A reason for issue says its kind on its published value
 * (Settings, Reasons for issue: "Kind of transmittal", prop `family`); one that says nothing is data. The backend
 * reads the same prop (a data transmittal carries a document: FILE_REQUIRED). A new kind is one entry here.
 */
export const TRANSMITTAL_KINDS = [
  { code: "DATA", family: "Data", label: "Data transmittal", says: "documents, for review, approval, execution…", typeLabel: "Issued for", typeHint: "what they should do with the documents" },
  { code: "INFO", family: "Information", label: "Information transmittal", says: "a request, an answer, a confirmation, an RFI", typeLabel: "Type of information", typeHint: "what kind of letter it is" },
] as const;

export type TransmittalKind = (typeof TRANSMITTAL_KINDS)[number]["code"];

/** The kind a reason belongs to, read from its published value. */
export function kindOf(props: Record<string, unknown>): TransmittalKind {
  return TRANSMITTAL_KINDS.find((k) => k.family === props.family)?.code ?? "DATA";
}

/** The kind's own entry. */
export function kind(code: TransmittalKind) {
  return TRANSMITTAL_KINDS.find((k) => k.code === code) ?? TRANSMITTAL_KINDS[0];
}
