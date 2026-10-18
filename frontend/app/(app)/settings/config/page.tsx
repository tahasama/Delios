import { ListsBoard, type Params } from "./board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Types & sets" };

/** Types & sets on a project: each list the organization's until changed here, where it leaves it free. */
export default async function ListsPage({ searchParams }: { searchParams: Promise<Params> }) {
  return <ListsBoard level="project" sp={await searchParams} />;
}
