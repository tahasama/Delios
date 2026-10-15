import "server-only";
import { api, projectPath, refusal } from "@/lib/client";

/**
 * Every list brought in on a screen is checked by the backend before anything reads it (`SheetGuard`): that it is what
 * its name says, that a workbook unpacks to a sane size and carries no macros, and that the virus check finds nothing.
 * Null when it may be read; else what to tell the person.
 */
export async function sheetRefusal(scope: { projectId: string }, file: File): Promise<string | null> {
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await api(projectPath(scope, "/sheets/check"), { body: { fileName: file.name, contentBase64: bytes.toString("base64") } });
    return null;
  } catch (e) {
    return refusal(e).message;
  }
}
