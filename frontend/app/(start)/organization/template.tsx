/**
 * A page arriving (after its outline in grey, or from another page) fades in, about 150 ms: what was there is not
 * swapped for what comes in a single frame. Opacity only: a transform here would hold every fixed bar under it.
 * A filter or a tab changed on the same page keeps the page as it is (no new template), so it does not fade.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  // The organization's pages are stacked sheets: their space between them is kept here, as the layout's was.
  return <div className="page-in space-y-4">{children}</div>;
}
