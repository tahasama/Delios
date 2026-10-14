import { redirect } from "next/navigation";

/** Kept so old links work: everyone reads the Schedule, narrowed to what is theirs. */
export default function NeededPage() {
  redirect("/actions");
}
