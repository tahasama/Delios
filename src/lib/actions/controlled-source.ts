"use server";

import { requireScope } from "@/lib/scope";
import { isAdmin, isController } from "@/lib/auth";

/** Linking the approved source of a record to a document revision: the backend keeps no such link yet. */
export async function linkControlledSourceAction(_prev: { error?: string; ok?: string } | undefined, _formData: FormData): Promise<{ error?: string; ok?: string }> {
  const { user } = await requireScope();
  if (!isController(user) && !isAdmin(user)) return { error: "Only document control can link the approved source." };
  return { error: "Linking the controlled source is not supported yet." };
}
