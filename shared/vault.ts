/**
 * Vault encryption. The master passphrase is stretched with PBKDF2-SHA256 into a non-extractable AES-GCM-256 key;
 * the whole card list is sealed as one JSON blob with a fresh 96-bit IV on every save. Only the sealed record is
 * ever stored or exported. The passphrase itself is never stored, so a forgotten passphrase cannot be recovered.
 */

export interface SealedVault {
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

export const isPin = (secret: string): boolean => /^\d{9}$/.test(secret);

export const KDF_ITERATIONS = 600_000; // OWASP 2023 guidance for PBKDF2-HMAC-SHA256

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(n));

export class WrongPassphraseError extends Error {
  constructor() {
    super("That passphrase does not open this vault.");
  }
}

export interface VaultKey {
  key: CryptoKey;
  salt: string;
  iter: number;
  pin: boolean;
}

export async function deriveKey(passphrase: string, salt = b64(random(16)), iter = KDF_ITERATIONS): Promise<VaultKey> {
  const material = await crypto.subtle.importKey("raw", enc.encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: unb64(salt), iterations: iter },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return { key, salt, iter, pin: isPin(passphrase) };
}

export async function seal<T>(data: T, vk: VaultKey): Promise<SealedVault> {
  const iv = random(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, vk.key, enc.encode(JSON.stringify(data))));
  const sealed: SealedVault = { v: 1, kdf: "PBKDF2-SHA256", iter: vk.iter, salt: vk.salt, iv: b64(iv), ct: b64(ct), savedAt: Date.now() };
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

/** Derives the key from the record's own salt and opens it. */
export async function unlock<T>(sealed: SealedVault, passphrase: string): Promise<{ data: T; vk: VaultKey }> {
  const vk = await deriveKey(passphrase, sealed.salt, sealed.iter);
  return { data: await open<T>(sealed, vk), vk };
}

export function isSealedVault(x: unknown): x is SealedVault {
  const r = x as SealedVault;
  return !!r && r.v === 1 && r.kdf === "PBKDF2-SHA256" && Number.isInteger(r.iter) && r.iter >= 100_000 &&
    [r.salt, r.iv, r.ct].every((s) => typeof s === "string" && s.length > 0);
}
