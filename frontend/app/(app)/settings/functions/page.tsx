import { FunctionsBoard } from "./board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Functions & permissions" };

/** Functions & permissions on a project: the organization's functions; what each may do, here where it is left free. */
export default async function FunctionsPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const { open } = await searchParams;
  return <FunctionsBoard level="project" open={open} />;
}
