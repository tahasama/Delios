import { PageSkeleton } from "@/components/skeleton";

/** Any page while it is read: its outline, never a blank page (owner, "skeleton loaders"). */
export default function Loading() {
  return <PageSkeleton />;
}
