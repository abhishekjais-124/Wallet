/**
 * Face ID / Touch ID unlock. A passkey on this device's own authenticator is created with the WebAuthn PRF
 * extension; after each successful biometric check the authenticator returns a secret that only it can produce.
 * That secret (through HKDF) wraps the 9-digit PIN with AES-GCM, and the wrapped PIN is kept on this device.
 * Nothing here weakens the vault: unlocking still derives the vault key from the PIN as before, and the wrapped
 * PIN is useless without the biometric check. Needs a secure context and a browser with PRF support
 * (iOS 18 / Safari 18 / recent Chrome); otherwise the PIN pad stays the only way in.
 */

const KEY = "wallet.bio.v1";
const INFO = new TextEncoder().encode("wallet-bio-v1");

interface Enrolment {
  credId: string;
  salt: string;
  iv: string;
  ct: string;
}

export interface PendingEnrolment {
  credId: string;
  salt: string;
}

export class BioUnsupportedError extends Error {}
/** The passkey worked but the stored wrap no longer opens: the PIN changed, or the wrap was damaged. */
export class BioStaleError extends Error {}

const b64u = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const random = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(n));

/** What this device calls its biometric check. */
export function bioLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1)) return "Face ID";
  if (/Mac/.test(ua)) return "Touch ID";
  return "Fingerprint or face";
}

/** True when this device has a biometric authenticator the browser can use. */
export async function available(): Promise<boolean> {
  try {
    return !!window.PublicKeyCredential && window.isSecureContext &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

export function enrolled(): boolean {
  return !!read();
}

function read(): Enrolment | null {
  try {
    const e = JSON.parse(localStorage.getItem(KEY) ?? "null") as Enrolment | null;
    return e && e.credId && e.salt && e.iv && e.ct ? e : null;
  } catch {
    return null;
  }
}

export function forget(): void {
  localStorage.removeItem(KEY);
}

/** Step 1: create the passkey (one biometric prompt). Throws BioUnsupportedError when PRF is not offered. */
export async function beginEnrol(): Promise<PendingEnrolment> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { id: location.hostname, name: "Wallet" },
      user: { id: random(16), name: "wallet", displayName: "Wallet" },
      challenge: random(32),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
      timeout: 60_000,
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was created.");
  const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean } };
  if (!ext.prf?.enabled) throw new BioUnsupportedError(`${bioLabel()} unlock needs a newer browser (iOS 18, Safari 18 or a recent Chrome).`);
  return { credId: b64u(cred.rawId), salt: b64u(random(32)) };
}

/** Step 2: one more biometric prompt gives the secret; the PIN is wrapped with it and kept on this device. */
export async function finishEnrol(pending: PendingEnrolment, pin: string): Promise<void> {
  const key = await prfKey(pending.credId, pending.salt);
  const iv = random(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(pin));
  const e: Enrolment = { credId: pending.credId, salt: pending.salt, iv: b64u(iv), ct: b64u(ct) };
  localStorage.setItem(KEY, JSON.stringify(e));
}

/** Biometric prompt, then the PIN. Throws when cancelled, unsupported or when the stored wrap no longer opens. */
export async function unlockWithBio(): Promise<string> {
  const e = read();
  if (!e) throw new Error(`${bioLabel()} is not set up on this device.`);
  const key = await prfKey(e.credId, e.salt);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(e.iv) }, key, unb64u(e.ct));
    return new TextDecoder().decode(pt);
  } catch {
    throw new BioStaleError("stale wrap");
  }
}

async function prfKey(credId: string, salt: string): Promise<CryptoKey> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: unb64u(credId) }],
      userVerification: "required",
      timeout: 60_000,
      extensions: { prf: { eval: { first: unb64u(salt) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const first = (assertion?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } })?.prf?.results?.first;
  if (!first) throw new BioUnsupportedError(`${bioLabel()} unlock needs a newer browser (iOS 18, Safari 18 or a recent Chrome).`);
  const material = await crypto.subtle.importKey("raw", first, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: unb64u(salt), info: INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** A friendly line for a failed biometric call. */
export function bioErrorMessage(err: unknown): string {
  if (err instanceof BioUnsupportedError) return err.message;
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError") return `${bioLabel()} was cancelled or timed out.`;
  if (name === "InvalidStateError") return "A passkey for Wallet already exists on this device. Turn it off in Settings and set it up again.";
  if (name === "SecurityError") return "This page is not allowed to use passkeys here.";
  return (err as Error)?.message || `${bioLabel()} did not work.`;
}
