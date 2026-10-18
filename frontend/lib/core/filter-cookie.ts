/** The cookie holding which filters a person keeps shown on a page (read by the server, written by the Filters menu). */
export const filterCookie = (page: string) => `edms_filters_${page}`;
