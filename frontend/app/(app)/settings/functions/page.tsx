import { FunctionsBoard } from "./board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Functions & permissions" };

/** Functions & permissions on a project: the organization's, read only here. */
export default async function FunctionsPage() {
  return <FunctionsBoard level="project" />;
}
