import { redirect } from "next/navigation";

/** Families organise document types and regulate nothing (owner): they are read on Help, their set in Types & sets. */
export default function FamiliesPage() {
  redirect("/guide#families");
}
