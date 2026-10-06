import type { ReferenceOption } from "./reference-data";

/**
 * ISO 3166-1 alpha-2 codes + common names. Stored as a code constant
 * (not a database table) — see ARCHITECTURE.md "Reference Data". Not
 * the complete UN list, but broad enough to cover real exporter markets.
 */
export const COUNTRIES: ReferenceOption[] = [
  { code: "AE", label: "United Arab Emirates" },
  { code: "AF", label: "Afghanistan" },
  { code: "AR", label: "Argentina" },
  { code: "AU", label: "Australia" },
  { code: "BD", label: "Bangladesh" },
  { code: "BE", label: "Belgium" },
  { code: "BH", label: "Bahrain" },
  { code: "BR", label: "Brazil" },
  { code: "CA", label: "Canada" },
  { code: "CH", label: "Switzerland" },
  { code: "CL", label: "Chile" },
  { code: "CN", label: "China" },
  { code: "CO", label: "Colombia" },
  { code: "DE", label: "Germany" },
  { code: "DK", label: "Denmark" },
  { code: "EG", label: "Egypt" },
  { code: "ES", label: "Spain" },
  { code: "ET", label: "Ethiopia" },
  { code: "FI", label: "Finland" },
  { code: "FR", label: "France" },
  { code: "GB", label: "United Kingdom" },
  { code: "GH", label: "Ghana" },
  { code: "GR", label: "Greece" },
  { code: "HK", label: "Hong Kong" },
  { code: "ID", label: "Indonesia" },
  { code: "IE", label: "Ireland" },
  { code: "IL", label: "Israel" },
  { code: "IN", label: "India" },
  { code: "IQ", label: "Iraq" },
  { code: "IR", label: "Iran" },
  { code: "IT", label: "Italy" },
  { code: "JO", label: "Jordan" },
  { code: "JP", label: "Japan" },
  { code: "KE", label: "Kenya" },
  { code: "KR", label: "South Korea" },
  { code: "KW", label: "Kuwait" },
  { code: "LK", label: "Sri Lanka" },
  { code: "MA", label: "Morocco" },
  { code: "MM", label: "Myanmar" },
  { code: "MX", label: "Mexico" },
  { code: "MY", label: "Malaysia" },
  { code: "NG", label: "Nigeria" },
  { code: "NL", label: "Netherlands" },
  { code: "NO", label: "Norway" },
  { code: "NP", label: "Nepal" },
  { code: "NZ", label: "New Zealand" },
  { code: "OM", label: "Oman" },
  { code: "PH", label: "Philippines" },
  { code: "PK", label: "Pakistan" },
  { code: "PL", label: "Poland" },
  { code: "PT", label: "Portugal" },
  { code: "QA", label: "Qatar" },
  { code: "RO", label: "Romania" },
  { code: "RU", label: "Russia" },
  { code: "SA", label: "Saudi Arabia" },
  { code: "SE", label: "Sweden" },
  { code: "SG", label: "Singapore" },
  { code: "TH", label: "Thailand" },
  { code: "TR", label: "Turkey" },
  { code: "TW", label: "Taiwan" },
  { code: "TZ", label: "Tanzania" },
  { code: "UA", label: "Ukraine" },
  { code: "UG", label: "Uganda" },
  { code: "US", label: "United States" },
  { code: "VN", label: "Vietnam" },
  { code: "ZA", label: "South Africa" },
].sort((a, b) => a.label.localeCompare(b.label));

const COUNTRY_CODE_SET = new Set(COUNTRIES.map((c) => c.code));

export function isValidCountryCode(code: string): boolean {
  return COUNTRY_CODE_SET.has(code.toUpperCase());
}

export function countryLabel(code: string): string {
  return COUNTRIES.find((c) => c.code === code)?.label ?? code;
}
