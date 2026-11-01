/** Card model and pure helpers: network detection, Luhn, formatting, masking, expiry. */

export type CardKind = "credit" | "debit";
export type Network = "visa" | "mastercard" | "rupay" | "amex" | "diners" | "discover" | "maestro" | "jcb" | "other";

export interface Card {
  id: string;
  bank: string;
  nickname: string;
  holder: string;
  kind: CardKind;
  network: Network;
  /** digits only */
  number: string;
  /** "MM/YY" */
  expiry: string;
  cvv: string;
  category: string;
  favorite: boolean;
  /** card face gradient, taken from the uploaded card photo or picked by hand */
  colors: [string, string];
  createdAt: number;
  updatedAt: number;
}

export const NETWORK_LABEL: Record<Network, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  rupay: "RuPay",
  amex: "American Express",
  diners: "Diners Club",
  discover: "Discover",
  maestro: "Maestro",
  jcb: "JCB",
  other: "Other",
};

// order matters: RuPay and Maestro ranges overlap broader Discover / Mastercard prefixes
const IIN: [Network, RegExp][] = [
  ["amex", /^3[47]/],
  ["jcb", /^35(2[89]|[3-8])/],
  ["diners", /^3(0[0-5]|[689])/],
  ["rupay", /^(508[5-9]|60[6-8]|652[1-9]|6530|8[12])/],
  ["maestro", /^(5018|5020|5038|6304|6759|676[1-3])/],
  ["discover", /^(6011|64[4-9]|65)/],
  ["mastercard", /^(5[1-5]|2[2-7])/],
  ["visa", /^4/],
];

export const digits = (s: string): string => s.replace(/\D/g, "");

export function detectNetwork(number: string): Network {
  const n = digits(number);
  return IIN.find(([, re]) => re.test(n))?.[0] ?? "other";
}

export function luhnValid(number: string): boolean {
  const n = digits(number);
  if (n.length < 12 || n.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < n.length; i++) {
    let d = Number(n[n.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Groups digits the way the card prints them: Amex 4-6-5, Diners 4-6-4, everyone else in fours. */
export function formatNumber(number: string, network = detectNetwork(number)): string {
  const n = digits(number);
  const groups = network === "amex" ? [4, 6, 5] : network === "diners" && n.length === 14 ? [4, 6, 4] : null;
  if (!groups) return n.replace(/(.{4})/g, "$1 ").trim();
  const out: string[] = [];
  let at = 0;
  for (const g of groups) {
    if (at >= n.length) break;
    out.push(n.slice(at, at + g));
    at += g;
  }
  if (at < n.length) out.push(n.slice(at));
  return out.join(" ");
}

export const last4 = (number: string): string => digits(number).slice(-4);

/** Every digit except the last four becomes a dot, keeping the printed grouping. */
export function maskNumber(number: string, network?: Network): string {
  const n = digits(number);
  let seen = 0;
  return formatNumber(n, network ?? detectNetwork(n)).replace(/\d/g, (d) => (++seen <= n.length - 4 ? "•" : d));
}

/** "0729", "7/29", "07 / 2029" → "07/29"; null when the month or year is not valid. */
export function normalizeExpiry(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})\s*\/?\s*(\d{2}|\d{4})$/) ?? digits(input).match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  return `${String(month).padStart(2, "0")}/${m[2]!.slice(-2)}`;
}

export type ExpiryState = "ok" | "soon" | "expired";

/** A card is valid through the last day of its expiry month; "soon" means within 60 days. */
export function expiryState(expiry: string, now = new Date()): ExpiryState {
  const [mm, yy] = expiry.split("/").map(Number);
  if (!mm || yy === undefined) return "ok";
  const end = new Date(2000 + yy, mm, 1); // first day after the expiry month
  if (now >= end) return "expired";
  return end.getTime() - now.getTime() < 60 * 864e5 ? "soon" : "ok";
}

export const cvvLength = (network: Network): number => (network === "amex" ? 4 : 3);

/** Light or dark ink for text printed on a gradient, from the average relative luminance. */
export function inkFor([a, b]: [string, string]): "light" | "dark" {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  return (lum(a) + lum(b)) / 2 > 0.42 ? "dark" : "light";
}
