import { cookies } from "next/headers";
import { filterCookie } from "./filter-cookie";

/**
 * The filters a person keeps shown on a page (the Filters menu, `components/filter-menu.tsx`), read from the cookie the
 * menu writes; none kept yet, the page's usual ones. A filter holding a value is shown whatever this says.
 */
export async function shownFilters(page: string, defaults: string[]): Promise<string[]> {
  const kept = (await cookies()).get(filterCookie(page))?.value;
  return kept === undefined ? defaults : decodeURIComponent(kept).split(",").filter(Boolean);
}
