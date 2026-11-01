/** Identity documents kept next to the cards: Aadhaar, PAN and driving licence, with photos or a PDF of each. */

export type DocType = "aadhaar" | "pan" | "dl";

export interface DocFile {
  id: string;
  name: string;
  /** MIME type: image/jpeg for photos, application/pdf for PDFs */
  type: string;
  /** data URL, only until the file is moved to the blob store (and in records made before it existed) */
  data?: string;
  /** the file's own AES-GCM key (base64) once it lives in the blob store: IndexedDB here, Google Drive app folder */
  key?: string;
  size: number;
}

export interface IdDoc {
  id: string;
  type: DocType;
  name: string;
  number: string;
  /** "DD/MM/YYYY" */
  dob: string;
  /** driving licence only, "DD/MM/YYYY" */
  validTill?: string;
  files: DocFile[];
  createdAt: number;
  updatedAt: number;
}

export const DOC_TYPES: DocType[] = ["aadhaar", "pan", "dl"];
export const DOC_LABEL: Record<DocType, string> = { aadhaar: "Aadhaar", pan: "PAN", dl: "Driving licence" };
export const DOC_SUBTITLE: Record<DocType, string> = {
  aadhaar: "Unique identity number",
  pan: "Permanent Account Number",
  dl: "Transport · motor vehicles",
};

export function normalizeDocNumber(type: DocType, input: string): string {
  return type === "aadhaar" ? input.replace(/\D/g, "").slice(0, 12) : input.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20);
}

export function validDocNumber(type: DocType, n: string): boolean {
  if (type === "aadhaar") return /^[2-9]\d{11}$/.test(n);
  if (type === "pan") return /^[A-Z]{5}\d{4}[A-Z]$/.test(n);
  return /^[A-Z0-9-]{8,20}$/.test(n);
}

export function formatDocNumber(type: DocType, n: string): string {
  return type === "aadhaar" ? n.replace(/(.{4})(?=.)/g, "$1 ") : n;
}

/** Everything but the last four characters hidden, keeping Aadhaar's 4-4-4 grouping. */
export function maskDocNumber(type: DocType, n: string): string {
  if (!n) return "";
  const hidden = n.slice(0, -4).replace(/[A-Z0-9]/gi, type === "aadhaar" ? "X" : "•");
  return formatDocNumber(type, hidden + n.slice(-4));
}

/** "1/2/90", "01021990", "01-02-1990" → "01/02/1990"; null when not a real date. */
export function normalizeDate(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})[/\-. ]?(\d{1,2})[/\-. ]?(\d{4})$/) ?? input.replace(/\D/g, "").match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || y < 1900 || y > 2200) return null;
  return `${String(d).padStart(2, "0")}/${String(mo).padStart(2, "0")}/${y}`;
}

/** Union by id; when both sides have an item, the more recently edited copy wins. */
export function mergeById<T extends { id: string; updatedAt: number }>(mine: T[], theirs: T[]): T[] {
  const byId = new Map(mine.map((x) => [x.id, x]));
  for (const x of theirs) if ((byId.get(x.id)?.updatedAt ?? -1) < x.updatedAt) byId.set(x.id, x);
  return [...byId.values()];
}

/** id → when it was deleted (ms). Kept in the vault so a sync can tell "deleted here" from "new there". */
export type Tombstones = Record<string, number>;

const TOMBSTONE_TTL = 180 * 864e5;

/** Both devices' deletions; the later time wins, and entries older than 180 days are dropped. */
export function mergeTombstones(a: Tombstones = {}, b: Tombstones = {}, now = Date.now()): Tombstones {
  const out: Tombstones = {};
  for (const [id, at] of [...Object.entries(a), ...Object.entries(b)]) {
    if (now - at < TOMBSTONE_TTL && at > (out[id] ?? 0)) out[id] = at;
  }
  return out;
}

/**
 * Two devices' lists after a sync: newest copy of each item, minus items deleted on either side. An item edited after
 * it was deleted elsewhere is kept, because that edit is the newer intent.
 */
export function mergeLive<T extends { id: string; updatedAt: number }>(mine: T[], theirs: T[], deleted: Tombstones): T[] {
  return mergeById(mine, theirs).filter((x) => !((deleted[x.id] ?? 0) >= x.updatedAt));
}
