/** Project types: what kind of project it is. They describe the project; they add nothing to its lists. Safe to import in client components. */
export const PROJECT_KINDS: { code: string; label: string; description: string }[] = [
  { code: "GENERIC", label: "General", description: "Any kind of project." },
  { code: "INDUSTRIAL", label: "Industrial / process plant", description: "Process and manufacturing plants: equipment-heavy engineering, P&IDs, line lists, HAZOP, pre-commissioning and start-up." },
  { code: "ENERGY", label: "Energy / power", description: "Generation, transmission and renewables: single-line diagrams, protection settings, grid studies, energization." },
  { code: "CONSTRUCTION", label: "Construction / buildings", description: "Buildings and infrastructure: submittals, RFIs, shop drawings, inspection and test plans, handover and defects liability." },
];
