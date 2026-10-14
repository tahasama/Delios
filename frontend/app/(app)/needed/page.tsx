import { redirect } from "next/navigation";

/** Kept so old links work: everyone reads Schedule & actions, narrowed to what is theirs. */
export default function NeededPage() {
  redirect("/actions");
}
