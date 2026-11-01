/**
 * Attachments (ID photos and PDFs) live outside the vault so the vault stays small. Each file is encrypted with its
 * own random AES-GCM key; the key sits in the file's record inside the encrypted vault, so any device that can open
 * the vault can read the file, and a PIN change does not touch the files. The encrypted bytes are kept in this
 * device's IndexedDB and uploaded to the Google Drive app folder as blob-<id>; a device without a local copy
 * fetches it from Drive on first use. Uploads and deletes made while offline or signed out wait in a queue.
 */
import type { DocFile } from "@shared/doc.ts";
import { account, token } from "./google.ts";
import { deleteBlob, pullBlob, pushBlob } from "./sync.ts";

const DB = "wallet-blobs";
const STORE = "blobs";
const QUEUE = "wallet.blobs.queue";

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const r = run(store);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const getLocal = (id: string) => tx<ArrayBuffer | undefined>("readonly", (s) => s.get(id) as IDBRequest<ArrayBuffer | undefined>);
const putLocal = (id: string, bytes: Uint8Array) => tx("readwrite", (s) => s.put(bytes.slice().buffer, id));
const delLocal = (id: string) => tx("readwrite", (s) => s.delete(id));

// ---- encoding helpers ----

const b64 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const dataUrlBytes = (url: string) => unb64(url.slice(url.indexOf(",") + 1));
const importKey = (raw: string) => crypto.subtle.importKey("raw", unb64(raw), "AES-GCM", false, ["encrypt", "decrypt"]);

async function seal(raw: string, plain: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(raw), plain));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

async function open(raw: string, sealed: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.subarray(0, 12) }, await importKey(raw), sealed.subarray(12));
}

// ---- upload / delete queue ----

interface Queue { up: string[]; del: string[] }
function queue(): Queue {
  try {
    return { up: [], del: [], ...(JSON.parse(localStorage.getItem(QUEUE) ?? "{}") as Partial<Queue>) };
  } catch {
    return { up: [], del: [] };
  }
}
const saveQueue = (q: Queue) => localStorage.setItem(QUEUE, JSON.stringify(q));

let flushing = false;
/** Uploads waiting files and deletes removed ones in Drive. Quietly does nothing when signed out or offline. */
export async function flushBlobs(): Promise<void> {
  if (flushing || !account() || !token()) return;
  flushing = true;
  try {
    const q = queue();
    for (const id of [...q.up]) {
      const bytes = await getLocal(id);
      if (bytes) await pushBlob(id, new Uint8Array(bytes));
      q.up = q.up.filter((x) => x !== id);
      saveQueue(q);
    }
    for (const id of [...q.del]) {
      await deleteBlob(id);
      q.del = q.del.filter((x) => x !== id);
      saveQueue(q);
    }
  } catch {
    /* offline or token expired: the queue is kept for the next sync */
  } finally {
    flushing = false;
  }
}

export const pendingUploads = () => queue().up.length;

// ---- public API ----

/** Moves a freshly added file (inline data URL) into the blob store; returns the record kept in the vault. */
export async function storeFile(f: DocFile): Promise<DocFile> {
  if (!f.data) return f;
  const key = b64(crypto.getRandomValues(new Uint8Array(32)));
  await putLocal(f.id, await seal(key, dataUrlBytes(f.data)));
  const q = queue();
  q.up = [...new Set([...q.up, f.id])];
  saveQueue(q);
  void flushBlobs();
  const { data: _inline, ...rest } = f;
  return { ...rest, key };
}

/** The file's bytes: inline data, this device's copy, or fetched once from Drive. */
export async function fileBlob(f: DocFile): Promise<Blob> {
  if (f.data) return new Blob([dataUrlBytes(f.data)], { type: f.type });
  if (!f.key) throw new Error("This file has no key.");
  let sealed = await getLocal(f.id).then((b) => (b ? new Uint8Array(b) : null));
  if (!sealed) {
    if (!account() || !token()) throw new Error("This file is in your Google Drive. Sign in with Google in Settings to open it here.");
    sealed = await pullBlob(f.id);
    if (!sealed) throw new Error("This file is missing from Google Drive.");
    await putLocal(f.id, sealed);
  }
  return new Blob([await open(f.key, sealed)], { type: f.type });
}

/** Removes a file from this device and, now or at the next sync, from Drive. */
export async function forgetFile(id: string): Promise<void> {
  await delLocal(id).catch(() => {});
  const q = queue();
  q.up = q.up.filter((x) => x !== id);
  q.del = [...new Set([...q.del, id])];
  saveQueue(q);
  void flushBlobs();
}

/** Encrypted bytes of the given files, for a backup file (already encrypted; keys stay inside the vault). */
export async function exportBlobs(files: DocFile[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of files) {
    if (f.data || !f.key) continue;
    let bytes = await getLocal(f.id).then((b) => (b ? new Uint8Array(b) : null));
    if (!bytes && account() && token()) bytes = await pullBlob(f.id).catch(() => null);
    if (bytes) out[f.id] = b64(bytes);
  }
  return out;
}

/** Puts a backup's encrypted files on this device and queues them for Drive. */
export async function importBlobs(blobs: Record<string, string>): Promise<void> {
  const q = queue();
  for (const [id, data] of Object.entries(blobs)) {
    await putLocal(id, unb64(data));
    q.up = [...new Set([...q.up, id])];
  }
  saveQueue(q);
  void flushBlobs();
}
