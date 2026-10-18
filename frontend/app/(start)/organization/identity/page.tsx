import { requireOrgAdmin } from "@/lib/core/org-scope";
import { ownIdentity, claims, merges } from "@/lib/organization/api";
import { WhoWeAre } from "../identity";

export const dynamic = "force-dynamic";
export const metadata = { title: "Who we are on DELIOS" };

/** Who we are on DELIOS: our identifier and domain, the entries others made for us to claim, and the merges asked of us. */
export default async function IdentityPage() {
  await requireOrgAdmin();
  const [own, claimable, mergeList] = await Promise.all([ownIdentity(), claims(), merges()]);
  return <WhoWeAre own={own} claimable={claimable} mergeList={mergeList} />;
}
