import { FieldsBoard, type Params } from "./board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forms & fields" };

/** Forms & fields on a project: each form the organization's until changed here, where it leaves forms free. */
export default async function FieldsPage({ searchParams }: { searchParams: Promise<Params> }) {
  return <FieldsBoard level="project" sp={await searchParams} />;
}
