import type { Card } from "@shared/card.ts";
import type { IdDoc } from "@shared/doc.ts";
import { isSealedVault, type SealedVault } from "@shared/vault.ts";

export interface VaultData {
  cards: Card[];
  /** identity documents; absent in vaults made before IDs existed */
  docs?: IdDoc[];
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
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readSealedFile(file: File): Promise<SealedVault> {
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
