import { redirect } from "next/navigation";

/**
 * The codes page is gone (owner: it repeated Types & sets, which everyone of ours reads): the states the app fixes are
 * on Help, each list's values in Types & sets. The old address leads to the states.
 */
export default function CodesPage() {
  redirect("/guide#states");
}
