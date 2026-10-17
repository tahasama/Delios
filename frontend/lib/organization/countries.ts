/**
 * Every country an identifier can be given in (ISO 3166, two letters), named in plain English by the browser's own
 * list (`Intl.DisplayNames`), sorted by name.
 */
const CODES = (
  "AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ " +
  "DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO " +
  "JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE " +
  "NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG " +
  "TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW"
).split(" ");

const names = new Intl.DisplayNames(["en"], { type: "region" });

/** The countries, by name. */
export const COUNTRIES: { code: string; name: string }[] = CODES
  .map((code) => ({ code, name: code === "XK" ? "Kosovo" : names.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const countryName = (code: string | null | undefined) => (code ? COUNTRIES.find((c) => c.code === code)?.name ?? code : null);

/** The kinds of identifier, best first: what each is, in words. */
export const IDENTIFIER_KINDS: { value: string; label: string; hint: string }[] = [
  { value: "COMPANY", label: "Company registration", hint: "the country's register of companies (RC, SIREN, Companies House…)" },
  { value: "TAX", label: "Tax number", hint: "when it has no company registration (VAT, ICE, EIN…)" },
  { value: "PROFESSIONAL", label: "Professional register", hint: "someone working alone: an order of architects or engineers" },
  { value: "PUBLIC", label: "Public body", hint: "a ministry, a municipality, a utility: its government identifier" },
];
