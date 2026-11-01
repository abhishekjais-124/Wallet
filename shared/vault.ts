/**
 * Vault encryption.
 *
 * v2 (current): the data is sealed with a random 256-bit master key (AES-GCM, fresh IV on every save). The master key
 * is stored only wrapped:
 *   - `local`    by the PIN (PBKDF2-SHA256, 600k). Kept on this device only, never uploaded or exported.
 *   - `recovery` by a random 24-character recovery key (~120 bits). The only wrap in the Google Drive copy and in
 *                backup files, so a stolen copy cannot be opened by guessing the 9-digit PIN.
 * `kid` names the master key, so two devices can tell whether they share it. A new device opens the Drive copy with
 * the recovery key once and sets its own PIN.
 *
 * v1 (older vaults): the data was sealed directly with a PIN-derived key. Still readable; migrated to v2 on unlock.
 * Neither the PIN nor the recovery key is stored, so losing both means the data cannot be recovered.
 */

export interface KeyWrap {
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

export interface SealedVaultV1 {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string;
  iv: string;
  ct: string;
  /** set when the secret is a 9-digit PIN, so the lock screen shows the number pad */
  pin?: true;
  /** when this record was sealed (ms); sync keeps the newest */
  savedAt?: number;
}

export interface SealedVaultV2 {
  v: 2;
  /** id of the master key; equal on every device that shares this wallet */
  kid: string;
  iv: string;
  ct: string;
  pin?: true;
  savedAt?: number;
  wraps: { local?: KeyWrap; recovery?: KeyWrap };
}

export type SealedVault = SealedVaultV1 | SealedVaultV2;

export const isPin = (secret: string): boolean => /^\d{9}$/.test(secret);
export const isV2 = (s: SealedVault): s is SealedVaultV2 => s.v === 2;

export const KDF_ITERATIONS = 600_000; // OWASP 2023 guidance for PBKDF2-HMAC-SHA256
// the recovery key already carries ~120 bits, so stretching only needs to be moderate
const RECOVERY_ITERATIONS = 100_000;

const enc = new TextEncoder();
const dec = new TextDecoder();
// in 32 KB chunks: spreading a whole vault (photos, PDFs) into one call overflows the call stack
const b64 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(n));

export class WrongPassphraseError extends Error {
  constructor(message = "That passphrase does not open this vault.") {
    super(message);
  }
}

/**
 * What an unlocked vault holds in memory. v2: the master key (`key`, plus its raw bytes for re-wrapping) and the
 * wraps to write back. v1: the PIN-derived key with its salt and iterations.
 */
export interface VaultKey {
  key: CryptoKey;
  pin: boolean;
  salt?: string;
  iter?: number;
  raw?: Uint8Array<ArrayBuffer>;
  kid?: string;
  wraps?: SealedVaultV2["wraps"];
}

async function stretch(secret: string, salt: string, iter: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", enc.encode(secret.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: unb64(salt), iterations: iter },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** v1: a key derived straight from the passphrase. */
export async function deriveKey(passphrase: string, salt = b64(random(16)), iter = KDF_ITERATIONS): Promise<VaultKey> {
  return { key: await stretch(passphrase, salt, iter), salt, iter, pin: isPin(passphrase) };
}

// ---- recovery key ----

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

/** 24 characters from a 32-symbol alphabet (120 bits), shown as six groups of four. */
export function newRecoveryKey(): string {
  const chars = [...random(24)].map((b) => ALPHABET[b & 31]).join("");
  return chars.replace(/(.{4})(?=.)/g, "$1-");
}

export const normalizeRecoveryKey = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/[I]/g, "1");

// ---- master-key wraps ----

async function wrap(raw: Uint8Array<ArrayBuffer>, secret: string, iter: number): Promise<KeyWrap> {
  const salt = b64(random(16));
  const iv = random(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await stretch(secret, salt, iter), raw));
  return { kdf: "PBKDF2-SHA256", iter, salt, iv: b64(iv), ct: b64(ct) };
}

async function unwrap(w: KeyWrap, secret: string, wrong: string): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(w.iv) }, await stretch(secret, w.salt, w.iter), unb64(w.ct)));
  } catch {
    throw new WrongPassphraseError(wrong);
  }
}

const masterKey = (raw: Uint8Array<ArrayBuffer>) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

/** A new master key, wrapped by the PIN for this device and by the recovery key for Drive and backups. */
export async function createKeys(pin: string, recovery: string): Promise<VaultKey> {
  const raw = random(32);
  return {
    key: await masterKey(raw),
    raw,
    kid: b64(random(9)),
    pin: isPin(pin),
    wraps: { local: await wrap(raw, pin, KDF_ITERATIONS), recovery: await wrap(raw, normalizeRecoveryKey(recovery), RECOVERY_ITERATIONS) },
  };
}

/** Same master key, new PIN on this device. */
export async function rewrapLocal(vk: VaultKey, pin: string): Promise<VaultKey> {
  if (!vk.raw) throw new Error("This wallet needs to be upgraded first.");
  return { ...vk, pin: isPin(pin), wraps: { ...vk.wraps, local: await wrap(vk.raw, pin, KDF_ITERATIONS) } };
}

/** Same master key, new recovery key (the old one stops opening new copies). */
export async function rewrapRecovery(vk: VaultKey, recovery: string): Promise<VaultKey> {
  if (!vk.raw) throw new Error("This wallet needs to be upgraded first.");
  return { ...vk, wraps: { ...vk.wraps, recovery: await wrap(vk.raw, normalizeRecoveryKey(recovery), RECOVERY_ITERATIONS) } };
}

// ---- seal / open ----

export async function seal<T>(data: T, vk: VaultKey): Promise<SealedVault> {
  const iv = random(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, vk.key, enc.encode(JSON.stringify(data))));
  const sealed: SealedVault = vk.raw && vk.kid && vk.wraps
    ? { v: 2, kid: vk.kid, iv: b64(iv), ct: b64(ct), savedAt: Date.now(), wraps: vk.wraps }
    : { v: 1, kdf: "PBKDF2-SHA256", iter: vk.iter ?? KDF_ITERATIONS, salt: vk.salt ?? "", iv: b64(iv), ct: b64(ct), savedAt: Date.now() };
  if (vk.pin) sealed.pin = true;
  return sealed;
}

export async function open<T>(sealed: SealedVault, vk: VaultKey): Promise<T> {
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) }, vk.key, unb64(sealed.ct));
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    throw new WrongPassphraseError(); // AES-GCM authentication fails for a wrong key and for tampered data alike
  }
}

/** Opens with the PIN (or an older passphrase): v1 directly, v2 through this device's own wrap. */
export async function unlock<T>(sealed: SealedVault, passphrase: string): Promise<{ data: T; vk: VaultKey }> {
  if (!isV2(sealed)) {
    const vk = await deriveKey(passphrase, sealed.salt, sealed.iter);
    return { data: await open<T>(sealed, vk), vk };
  }
  if (!sealed.wraps.local) throw new NeedsRecoveryError();
  const raw = await unwrap(sealed.wraps.local, passphrase, "Wrong PIN.");
  const vk: VaultKey = { key: await masterKey(raw), raw, kid: sealed.kid, pin: isPin(passphrase), wraps: sealed.wraps };
  return { data: await open<T>(sealed, vk), vk };
}

/** A copy from Drive or a backup has no PIN wrap for this device: it opens only with the recovery key. */
export class NeedsRecoveryError extends Error {
  constructor() {
    super("This copy opens with your recovery key.");
  }
}

export async function unlockWithRecovery<T>(sealed: SealedVaultV2, recovery: string): Promise<{ data: T; vk: VaultKey }> {
  if (!sealed.wraps.recovery) throw new Error("This wallet has no recovery key.");
  const raw = await unwrap(sealed.wraps.recovery, normalizeRecoveryKey(recovery), "That recovery key does not open this wallet.");
  const vk: VaultKey = { key: await masterKey(raw), raw, kid: sealed.kid, pin: false, wraps: { recovery: sealed.wraps.recovery } };
  return { data: await open<T>(sealed, vk), vk };
}

/** The copy that may leave this device (Google Drive, backup files): without the PIN wrap. */
export function forRemote(s: SealedVault): SealedVault {
  if (!isV2(s)) return s;
  const { local: _pinWrap, ...wraps } = s.wraps;
  return { ...s, wraps };
}

const isWrap = (w: unknown): boolean => {
  const k = w as KeyWrap;
  return !!k && k.kdf === "PBKDF2-SHA256" && Number.isInteger(k.iter) && k.iter >= 100_000 &&
    [k.salt, k.iv, k.ct].every((s) => typeof s === "string" && s.length > 0);
};

export function isSealedVault(x: unknown): x is SealedVault {
  const r = x as SealedVault;
  if (!r || ![r.iv, r.ct].every((s) => typeof s === "string" && s.length > 0)) return false;
  if (r.v === 1) return r.kdf === "PBKDF2-SHA256" && Number.isInteger(r.iter) && r.iter >= 100_000 && typeof r.salt === "string" && r.salt.length > 0;
  if (r.v === 2) {
    const w = r.wraps ?? {};
    return typeof r.kid === "string" && (!w.local || isWrap(w.local)) && (!w.recovery || isWrap(w.recovery)) && !!(w.local || w.recovery);
  }
  return false;
}
