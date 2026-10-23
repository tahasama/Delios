/**
 * A Primavera P6 export (.xer) holds far more than the schedule reads (resources, costs, codes, notebooks…), often tens
 * of megabytes. Before it is sent to be read, only what is read is kept, byte for byte: its header, the projects, the
 * WBS and the activities (TASK); the backend reads the same tables (`Actions/XerReader.cs`).
 */
const KEPT = new Set(["PROJECT", "PROJWBS", "TASK"]);

export function trimXer(bytes: Buffer): Buffer {
  // Latin-1 maps every byte to one character and back, so the lines kept come back exactly as they were.
  const text = bytes.toString("latin1");
  const out: string[] = [];
  let keep = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("ERMHDR")) out.push(line);
    else if (line.startsWith("%T\t")) {
      keep = KEPT.has(line.slice(3).trim());
      if (keep) out.push(line);
    } else if (line.startsWith("%E")) { out.push(line); break; }
    else if (keep) out.push(line);
  }
  return Buffer.from(out.join("\n"), "latin1");
}
