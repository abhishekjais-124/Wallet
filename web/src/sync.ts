/**
 * Sync of the sealed vault through the app's hidden Google Drive folder. Only the encrypted record travels; the PIN
 * and the cards in plain text never leave the device. The newest `savedAt` wins; a device with unsynced edits
 * merges instead (see App), so an offline edit on one device is not overwritten by the other.
 */
import { isSealedVault, type SealedVault } from "@shared/vault.ts";
import { rememberAccount, token } from "./google.ts";

const FILE = "wallet-vault.json";
const API = "https://www.googleapis.com";
const META_KEY = "wallet.sync";

export interface SyncMeta {
  /** savedAt of the last record both sides agreed on */
  syncedAt: number;
  /** local saves not yet uploaded */
  dirty: boolean;
  fileId?: string;
}

export class SyncAuthError extends Error {}

export function meta(): SyncMeta {
  try {
    return { syncedAt: 0, dirty: false, ...(JSON.parse(localStorage.getItem(META_KEY) ?? "{}") as Partial<SyncMeta>) };
  } catch {
    return { syncedAt: 0, dirty: false };
  }
}

export function setMeta(patch: Partial<SyncMeta>): SyncMeta {
  const next = { ...meta(), ...patch };
  localStorage.setItem(META_KEY, JSON.stringify(next));
  return next;
}

export const clearMeta = () => localStorage.removeItem(META_KEY);

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const t = token();
  if (!t) throw new SyncAuthError("Google sign-in expired.");
  const res = await fetch(API + path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${t}` } });
  if (res.status === 401 || res.status === 403) throw new SyncAuthError("Google sign-in expired.");
  if (!res.ok) throw new Error(`Google Drive answered ${res.status}.`);
  return res;
}

export async function whoAmI(): Promise<string> {
  const res = await call("/drive/v3/about?fields=user(emailAddress)");
  const email = ((await res.json()) as { user?: { emailAddress?: string } }).user?.emailAddress ?? "Google account";
  rememberAccount(email);
  return email;
}

async function fileId(): Promise<string | null> {
  const known = meta().fileId;
  if (known) return known;
  const q = encodeURIComponent(`name='${FILE}'`);
  const res = await call(`/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)&orderBy=modifiedTime desc`);
  const id = ((await res.json()) as { files?: { id: string }[] }).files?.[0]?.id ?? null;
  if (id) setMeta({ fileId: id });
  return id;
}

/** The vault stored in Drive, or null when this account has none yet. */
export async function pull(): Promise<SealedVault | null> {
  const id = await fileId();
  if (!id) return null;
  try {
    const res = await call(`/drive/v3/files/${id}?alt=media`);
    const parsed: unknown = await res.json();
    return isSealedVault(parsed) ? parsed : null;
  } catch (err) {
    if (err instanceof SyncAuthError) throw err;
    setMeta({ fileId: undefined }); // deleted from Drive: look it up again next time
    return null;
  }
}

export async function push(sealed: SealedVault): Promise<void> {
  const body = JSON.stringify(sealed);
  const id = await fileId();
  if (id) {
    await call(`/upload/drive/v3/files/${id}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
  } else {
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify({ name: FILE, parents: ["appDataFolder"] })], { type: "application/json" }));
    form.append("file", new Blob([body], { type: "application/json" }));
    const res = await call("/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", body: form });
    setMeta({ fileId: ((await res.json()) as { id: string }).id });
  }
  setMeta({ syncedAt: sealed.savedAt ?? 0, dirty: false });
}
