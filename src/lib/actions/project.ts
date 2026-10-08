"use server";

import { switchProjectAction as switchProject } from "./session";

/** Moves to another of the person's projects; the backend refuses one they are not on. */
export async function switchProjectAction(formData: FormData): Promise<void> {
  await switchProject(formData);
}
