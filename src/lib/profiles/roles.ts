type RoleRule = {
  functionCode: string;
  /** Who produced it, from DELIVERABLE_TYPES: ENG CTR VND TPY CLT. Absent means any. */
  deliverableType?: string;
  /** One document type, where the row exists only for it. */
  docType?: string;
  verbs: string[];
  note: string;
};

type ContractRole = {
  code: string;
  label: string;
  /** Where approval sits, in one line, for the person choosing at creation. */
  approval: string;
  description: string;
  matrix: RoleRule[];
};

/** Quality records that bind our own inspection, whoever holds the design. */
const QUALITY_TYPES = ["ITP", "NCR", "INS", "TST"];

/** Those records, approved by us, whatever the role does with everything else. */
const weApproveQuality = (why: string): RoleRule[] =>
  QUALITY_TYPES.map((docType) => ({
    functionCode: "APPROVER", docType, verbs: ["READ", "REVIEW", "APPROVE", "RECEIVE"], note: why,
  }));

export const CONTRACT_ROLES: ContractRole[] = [
  {
    code: "GENERIC",
    label: "Not stated",
    approval: "Whatever the published matrix says.",
    description: "No contract role declared. The matrix applies as published, with no role-specific rows.",
    matrix: [],
  },
  {
    code: "EPC",
    label: "EPC — engineer, procure, construct",
    approval: "With us. We approve our own engineering and our suppliers' data.",
    description: "We hold design and execution. Vendor data comes to us; the client receives.",
    matrix: [
      { functionCode: "AUTHOR", deliverableType: "ENG", verbs: ["READ", "CREATE", "REVISE", "RECEIVE"], note: "We produce the engineering." },
      { functionCode: "REVIEWER", deliverableType: "ENG", verbs: ["READ", "REVIEW", "RECEIVE"], note: "Checked inside the discipline." },
      { functionCode: "APPROVER", deliverableType: "ENG", verbs: ["READ", "REVIEW", "APPROVE", "RECEIVE"], note: "Approval of our own engineering sits with us." },
      { functionCode: "SUPPLIER", deliverableType: "VND", verbs: ["READ", "CREATE", "REVISE", "RECEIVE"], note: "Suppliers submit their own vendor data." },
      { functionCode: "REVIEWER", deliverableType: "VND", verbs: ["READ", "REVIEW", "RECEIVE"], note: "We review what suppliers send." },
      { functionCode: "APPROVER", deliverableType: "VND", verbs: ["READ", "REVIEW", "APPROVE", "RECEIVE"], note: "We decide on vendor data." },
      { functionCode: "CLIENT", deliverableType: "ENG", verbs: ["READ", "RECEIVE"], note: "The client receives our engineering; raise this to approval where the contract requires it." },
      { functionCode: "CONTROL_OFFICE", docType: "ITP", verbs: ["READ", "REVIEW", "RECEIVE"], note: "A third party witnesses inspection." },
      { functionCode: "CONTROL_OFFICE", docType: "CER", verbs: ["READ", "REVIEW", "RECEIVE"], note: "Certification is read and endorsed, never approved here." },
    ],
  },
  {
    code: "EPCM",
    label: "EPCM — engineer, procure, construction management",
    approval: "With us, for engineering and for what the contractor submits.",
    description: "We hold design and manage construction. Contractor and vendor submittals both come to us.",
    matrix: [
      { functionCode: "AUTHOR", deliverableType: "ENG", verbs: ["READ", "CREATE", "REVISE", "RECEIVE"], note: "We produce the engineering." },
      { functionCode: "REVIEWER", deliverableType: "ENG", verbs: ["READ", "REVIEW", "RECEIVE"], note: "Checked inside the discipline." },
      { functionCode: "APPROVER", deliverableType: "ENG", verbs: ["READ", "REVIEW", "APPROVE", "RECEIVE"], note: "Approval of our own engineering sits with us." },
      { functionCode: "CONTRACTOR", deliverableType: "CTR", verbs: ["READ", "CREATE", "REVISE", "RECEIVE"], note: "The contractor submits against the contract." },
      { functionCode: "REVIEWER", deliverableType: "CTR", verbs: ["READ", "REVIEW", "RECEIVE"], note: "We review contractor submittals." },
      { functionCode: "APPROVER", deliverableType: "CTR", verbs: ["READ", "REVIEW", "APPROVE", "RECEIVE"], note: "We decide on contractor submittals." },
      { functionCode: "SUPPLIER", deliverableType: "VND", verbs: ["READ", "CREATE", "REVISE", "RECEIVE"], note: "Suppliers submit their own vendor data." },
      { functionCode: "APPROVER", deliverableType: "VND", verbs: ["READ", "REVIEW", "APPROVE", "RECEIVE"], note: "We decide on vendor data." },
      { functionCode: "CLIENT", verbs: ["READ", "RECEIVE"], note: "The client receives." },
      { functionCode: "CONTROL_OFFICE", docType: "ITP", verbs: ["READ", "REVIEW", "RECEIVE"], note: "A third party witnesses inspection." },
    ],
  },
  {
    code: "PMC",
    label: "PMC — project management consultancy",
    approval: "Mostly outside us. The design office answers for its own content; the quality records stay ours.",
    description: "We manage for the client. Design sits with the design office and the architects, who review and approve their own technical content. We comment, and we approve what binds our own inspection.",
    matrix: [
      { functionCode: "DESIGN_OFFICE", deliverableType: "ENG", verbs: ["READ", "CREATE", "REVISE", "REVIEW", "APPROVE", "RECEIVE"], note: "The design office answers for its own technical content." },
      { functionCode: "REVIEWER", deliverableType: "ENG", verbs: ["READ", "REVIEW", "RECEIVE"], note: "We comment; we do not approve their design." },
      { functionCode: "CONTRACTOR", deliverableType: "CTR", verbs: ["READ", "CREATE", "REVISE", "RECEIVE"], note: "The contractor submits against the contract." },
      { functionCode: "REVIEWER", deliverableType: "CTR", verbs: ["READ", "REVIEW", "RECEIVE"], note: "We review contractor submittals." },
      { functionCode: "APPROVER", deliverableType: "CTR", verbs: ["READ", "REVIEW", "APPROVE", "RECEIVE"], note: "We decide on contractor submittals, for the client." },
      { functionCode: "SUPPLIER", deliverableType: "VND", verbs: ["READ", "CREATE", "REVISE", "RECEIVE"], note: "Suppliers submit their own vendor data." },
      { functionCode: "DESIGN_OFFICE", deliverableType: "VND", verbs: ["READ", "REVIEW", "APPROVE", "RECEIVE"], note: "Vendor data against their design is theirs to decide." },
      ...weApproveQuality("An inspection or quality record binds our own inspection, so it stays ours to approve even here."),
      { functionCode: "CONTROL_OFFICE", docType: "ITP", verbs: ["READ", "REVIEW", "RECEIVE"], note: "A third party witnesses inspection." },
      { functionCode: "CLIENT", verbs: ["READ", "RECEIVE"], note: "The client receives everything." },
    ],
  },
  {
    code: "DESIGN",
    label: "Design office / architect",
    approval: "Checked by us, approved by the client.",
    description: "We produce the design and check it internally. The approval that counts is the client's.",
    matrix: [
      { functionCode: "AUTHOR", deliverableType: "ENG", verbs: ["READ", "CREATE", "REVISE", "RECEIVE"], note: "We produce the design." },
      { functionCode: "REVIEWER", deliverableType: "ENG", verbs: ["READ", "REVIEW", "RECEIVE"], note: "Checked inside the discipline before it leaves." },
      { functionCode: "APPROVER", deliverableType: "ENG", verbs: ["READ", "REVIEW", "APPROVE", "RECEIVE"], note: "Our own release decision, before the client sees it." },
      { functionCode: "CLIENT", deliverableType: "ENG", verbs: ["READ", "REVIEW", "APPROVE", "RECEIVE"], note: "The approval that counts is the client's." },
      { functionCode: "CONTROL_OFFICE", docType: "CER", verbs: ["READ", "REVIEW", "RECEIVE"], note: "A control office endorses where the authority requires it." },
    ],
  },
  {
    code: "OWNER",
    label: "Owner / operator",
    approval: "With us. Everything comes to us.",
    description: "We own the asset. Designers, contractors and suppliers all submit to us, and we approve.",
    matrix: [
      { functionCode: "DESIGN_OFFICE", deliverableType: "ENG", verbs: ["READ", "CREATE", "REVISE", "RECEIVE"], note: "Our designers submit to us." },
      { functionCode: "CONTRACTOR", deliverableType: "CTR", verbs: ["READ", "CREATE", "REVISE", "RECEIVE"], note: "Our contractors submit to us." },
      { functionCode: "SUPPLIER", deliverableType: "VND", verbs: ["READ", "CREATE", "REVISE", "RECEIVE"], note: "Our suppliers submit to us." },
      { functionCode: "REVIEWER", verbs: ["READ", "REVIEW", "RECEIVE"], note: "We review whatever arrives." },
      { functionCode: "APPROVER", verbs: ["READ", "REVIEW", "APPROVE", "RECEIVE"], note: "Every approval is ours." },
      { functionCode: "CONTROL_OFFICE", docType: "CER", verbs: ["READ", "REVIEW", "RECEIVE"], note: "Certification is endorsed by the control office." },
    ],
  },
  {
    code: "CM",
    label: "Construction management",
    approval: "With us for execution and quality; design stays with the designer.",
    description: "We manage construction and hold no design. The designer answers for the design; we decide on what is built and how it is inspected.",
    matrix: [
      { functionCode: "DESIGN_OFFICE", deliverableType: "ENG", verbs: ["READ", "CREATE", "REVISE", "REVIEW", "APPROVE", "RECEIVE"], note: "The designer stays responsible for the design." },
      { functionCode: "CONTRACTOR", deliverableType: "CTR", verbs: ["READ", "CREATE", "REVISE", "RECEIVE"], note: "The contractor submits against the contract." },
      { functionCode: "REVIEWER", deliverableType: "CTR", verbs: ["READ", "REVIEW", "RECEIVE"], note: "We review contractor submittals." },
      { functionCode: "APPROVER", deliverableType: "CTR", verbs: ["READ", "REVIEW", "APPROVE", "RECEIVE"], note: "We decide on what is built." },
      ...weApproveQuality("Inspection and quality records are ours to approve: they bind our own inspection."),
      { functionCode: "CONTROL_OFFICE", docType: "ITP", verbs: ["READ", "REVIEW", "RECEIVE"], note: "A third party witnesses inspection." },
      { functionCode: "CLIENT", verbs: ["READ", "RECEIVE"], note: "The client receives." },
    ],
  },
];

export function roleFor(code: string | null | undefined): ContractRole | null {
  return CONTRACT_ROLES.find((r) => r.code === code) ?? null;
}

/** The label to print where a project's role is shown. */
export function roleLabel(code: string | null | undefined): string {
  return roleFor(code)?.label ?? "Not stated";
}
