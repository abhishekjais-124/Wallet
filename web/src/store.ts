import type { Card } from "@shared/card.ts";
import type { IdDoc, Tombstones } from "@shared/doc.ts";
import { isSealedVault, type SealedVault } from "@shared/vault.ts";

export interface VaultData {
  cards: Card[];
  /** identity documents; absent in vaults made before IDs existed */
  docs?: IdDoc[];
  /** cards and documents deleted here, so a sync with another device does not bring them back */
  deleted?: Tombstones;
}

/** Mount path without a trailing slash: "" at the domain root, "/Wallet" behind aj124.com/Wallet. */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const VAULT_KEY = "wallet.vault.v1";

// Only the sealed (encrypted) vault is written here; plaintext cards live in memory while unlocked.
export function loadSealed(): SealedVault | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(VAULT_KEY) ?? "null");
    return isSealedVault(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSealed(sealed: SealedVault): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(sealed)); // let quota errors reach the caller
  // ask the browser not to evict the vault under storage pressure (granted automatically for installed PWAs)
  navigator.storage?.persist?.().catch(() => {});
}

export function eraseSealed(): void {
  localStorage.removeItem(VAULT_KEY);
}

// Non-secret preferences.
export type ThemePref = "system" | "light" | "dark";
export type SortBy = "recent" | "bank" | "expiry";

export function getPref<T extends string | number>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`wallet.pref.${key}`);
    if (raw === null) return fallback;
    return (typeof fallback === "number" ? Number(raw) : raw) as T;
  } catch {
    return fallback;
  }
}

export function setPref(key: string, value: string | number): void {
  try {
    localStorage.setItem(`wallet.pref.${key}`, String(value));
  } catch {
    /* preferences are a convenience */
  }
}

export function downloadJson(name: string, data: unknown): void {
  downloadText(name, JSON.stringify(data, null, 2), "application/json");
}

export function downloadText(name: string, text: string, type = "text/plain"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A backup file: the sealed vault, plus the encrypted ID files (each still needs its key from inside the vault). */
export type BackupFile = SealedVault & { blobs?: Record<string, string> };

/** The vault part of a backup, without the bulky files, for storing as the device's vault. */
export const vaultOnly = ({ blobs: _files, ...vault }: BackupFile): SealedVault => vault;

export async function readSealedFile(file: File): Promise<BackupFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("That file is not a Wallet backup.");
  }
  if (!isSealedVault(parsed)) throw new Error("That file is not a Wallet backup.");
  return parsed;
}

export const newId = (): string => crypto.randomUUID();
