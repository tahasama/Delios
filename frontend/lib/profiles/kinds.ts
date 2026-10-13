import industrial from "./industrial.json";
import energy from "./energy.json";
import construction from "./construction.json";

/** Project types, from the starter profiles. Safe to import in client components. */
export const PROJECT_KINDS: { code: string; label: string; description: string }[] = [
  { code: "GENERIC", label: "General", description: "Reference lists only." },
  ...[industrial, energy, construction].map((p) => ({ code: p.projectKind, label: p.name, description: p.description })),
];
