import React, { useEffect, useState } from "react";
import {
  createKeys, isV2, newRecoveryKey, rewrapLocal, seal, unlock, unlockWithRecovery, WrongPassphraseError, type SealedVault, type VaultKey,
} from "@shared/vault.ts";
import { bioErrorMessage, bioLabel, BioStaleError, enrolled as bioEnrolled, forget as bioForget, unlockWithBio } from "../bio.ts";
import { importBlobs } from "../blobs.ts";
import { readSealedFile, saveSealed, vaultOnly, type VaultData } from "../store.ts";
import { Icon } from "../ui.tsx";
import { CLIENT_ID, signIn } from "../google.ts";
import { bioIcon } from "./BioSetup.tsx";
import { PinPad } from "./PinPad.tsx";
import { RecoveryInput } from "./Recovery.tsx";
import { GoogleMark } from "./Settings.tsx";

/**
 * Create a vault with a 9-digit PIN, or open the existing one. Vaults made with an older text passphrase keep a text
 * field. A copy from Google Drive or a backup has no PIN for this device yet: it opens with the recovery key, then
 * asks for a new PIN.
 */
export function Lock({ sealed, onOpen, onCreated }: {
  sealed: SealedVault | null;
  /** `recovery` is set when a new recovery key was just made, so it can be shown once */
  onOpen: (vk: VaultKey, data: VaultData, secret: string, recovery?: string) => void;
  onCreated: (sealed: SealedVault) => void;
}) {
  const [firstPin, setFirstPin] = useState<string | null>(null);
  // the number pad is the default for every vault; a vault made with a letters passphrase can switch to a text field
  const [useLetters, setUseLetters] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsRecovery = !!sealed && isV2(sealed) && !sealed.wraps.local;
  const [bio, setBio] = useState(() => !!sealed && !needsRecovery && bioEnrolled());
  // opened with the recovery key, waiting for this device's new PIN
  const [recovered, setRecovered] = useState<{ vk: VaultKey; data: VaultData } | null>(null);
  const [recoveryKey, setRecoveryKey] = useState("");

  async function open(secret: string): Promise<string | null> {
    if (!sealed) return "No wallet yet.";
    setBusy(true);
    setError(null);
    try {
      const { data, vk } = await unlock<VaultData>(sealed, secret);
      onOpen(vk, data, secret);
      return null;
    } catch (err) {
      const msg = err instanceof WrongPassphraseError ? (useLetters ? err.message : "Wrong PIN.") : `Could not open the wallet: ${(err as Error).message}`;
      setError(msg);
      setBusy(false);
      return msg;
    }
  }

  async function openWithBio() {
    setError(null);
    let pin: string | null = null;
    try {
      pin = await unlockWithBio();
    } catch (err) {
      if (!(err instanceof BioStaleError)) {
        setError(bioErrorMessage(err));
        return;
      }
    }
    if (pin === null || (await open(pin))) {
      // the PIN changed since the passkey was made (another device, or a restored backup): drop the stale wrap
      bioForget();
      setBio(false);
      setError(`The PIN changed since ${bioLabel()} was set up. Enter the PIN, then set it up again in Settings.`);
    }
  }

  // like a phone: ask for the face or finger as soon as the lock screen shows (browsers that need a tap just wait for the button)
  useEffect(() => {
    if (bio && document.visibilityState === "visible") void openWithBio().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(pin: string): Promise<string | null> {
    if (firstPin === null) {
      setFirstPin(pin);
      setError(null);
      return ""; // clears the dots for the repeat step
    }
    if (pin !== firstPin) {
      setFirstPin(null);
      setError("The PINs did not match. Start again.");
      return "mismatch";
    }
    setBusy(true);
    try {
      const recovery = recovered ? undefined : newRecoveryKey();
      const vk = recovered ? await rewrapLocal(recovered.vk, pin) : await createKeys(pin, recovery!);
      const data: VaultData = recovered?.data ?? { cards: [] };
      const s = await seal(data, vk);
      saveSealed(s);
      onCreated(s);
      onOpen(vk, data, pin, recovery);
      return null;
    } catch (err) {
      setBusy(false);
      setError(`Could not ${recovered ? "set the PIN" : "create the wallet"}: ${(err as Error).message}`);
      return "failed";
    }
  }

  async function openWithRecovery(e: React.FormEvent) {
    e.preventDefault();
    if (!sealed || !isV2(sealed)) return;
    setBusy(true);
    setError(null);
    try {
      setRecovered(await unlockWithRecovery<VaultData>(sealed, recoveryKey));
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function restore(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const backup = await readSealedFile(file);
      if (backup.blobs) await importBlobs(backup.blobs);
      const s = vaultOnly(backup);
      saveSealed(s);
      onCreated(s);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // a new wallet, or a recovered copy getting this device's PIN: both pick a PIN twice
  const creating = !sealed || !!recovered;
  const title = needsRecovery && !recovered ? "Enter your recovery key"
    : creating ? (firstPin === null ? (recovered ? "Set a PIN for this device" : "Create a 9-digit PIN") : "Repeat your PIN") : "Wallet is locked";
  const hint = needsRecovery && !recovered ? "This copy came from Google Drive or a backup. It opens with the recovery key you saved when the wallet was made."
    : creating
      ? firstPin === null ? "It unlocks the wallet on this device. Google Drive and backups stay locked by your recovery key." : "Enter the same nine digits again."
      : useLetters ? "Enter your passphrase, then switch to a PIN in Settings." : "Enter your 9-digit PIN.";

  return (
    <main className="lock">
      <div className="lock-card">
        <div className="lock-mark"><Icon name={creating ? "shield" : "lock"} size={26} /></div>
        <h1>{title}</h1>
        <p className="muted">{hint}</p>
        {bio && !creating && (
          <button type="button" className="btn primary block bio-btn" onClick={() => void openWithBio()} disabled={busy}>
            <Icon name={bioIcon()} size={22} /> Unlock with {bioLabel()}
          </button>
        )}
        {needsRecovery && !recovered ? (
          <form className="lock-form" autoComplete="off" onSubmit={openWithRecovery}>
            <RecoveryInput value={recoveryKey} onChange={setRecoveryKey} autoFocus />
            <button className="btn primary block" disabled={busy || recoveryKey.length < 29}><Icon name="key" /> Open wallet</button>
          </form>
        ) : creating || !useLetters ? (
          <PinPad key={recovered ? "recovered" : "pin"} busy={busy} onComplete={creating ? create : open} />
        ) : (
          <LegacyForm busy={busy} onSubmit={open} />
        )}
        {!creating && !needsRecovery && !sealed.pin && (
          <button type="button" className="btn ghost sm" onClick={() => { setUseLetters(!useLetters); setError(null); }}>
            {useLetters ? "Use the number pad" : "My passphrase has letters"}
          </button>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        {busy && <p className="fine"><span className="spinner dark" aria-hidden="true" /> {creating && !recovered ? "Creating…" : "Unlocking…"}</p>}
        {!sealed ? (
          <>
            <p className="fine">Next you get a recovery key. Save it: it opens the wallet on a new device or from a backup.</p>
            {CLIENT_ID && (
              <button type="button" className="btn block" onClick={() => signIn()}>
                <GoogleMark /> Restore with Google
              </button>
            )}
            <label className="btn ghost block">
              <Icon name="upload" /> Restore from a backup
              <input type="file" accept="application/json,.json" hidden onChange={restore} />
            </label>
          </>
        ) : needsRecovery && !recovered ? (
          <p className="fine">Lost the recovery key? Unlock on a device that still has the wallet and make a new one in Settings.</p>
        ) : (
          <p className="fine"><Icon name="shield" size={14} /> AES-256-GCM · stored only on this device</p>
        )}
      </div>
    </main>
  );
}

function LegacyForm({ busy, onSubmit }: { busy: boolean; onSubmit: (secret: string) => Promise<string | null> }) {
  const [pass, setPass] = useState("");
  return (
    <form className="lock-form" autoComplete="off" onSubmit={(e) => { e.preventDefault(); void onSubmit(pass); }}>
      <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus autoComplete="current-password" aria-label="Passphrase" />
      <button className="btn primary block" disabled={busy || !pass}><Icon name="key" /> Unlock</button>
    </form>
  );
}
