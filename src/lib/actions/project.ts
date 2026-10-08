"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { setActiveProject } from "@/lib/scope";

/**
 * Move the session to another project. The switch is refused unless the user
 * holds an active membership there, so the cookie can never widen access.
 */
export async function switchProjectAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return;

  const ok = await setActiveProject(projectId, user.id);
  if (!ok) redirect("/?denied=1");

  // Everything on screen belongs to the old project.
  revalidatePath("/", "layout");
  redirect("/");
}
