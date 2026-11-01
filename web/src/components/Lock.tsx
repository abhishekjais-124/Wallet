import React, { useState } from "react";
import { deriveKey, seal, unlock, WrongPassphraseError, type SealedVault, type VaultKey } from "@shared/vault.ts";
import { readSealedFile, saveSealed, type VaultData } from "../store.ts";
import { Icon } from "../ui.tsx";
import { PinPad } from "./PinPad.tsx";

/** Create a vault with a 9-digit PIN, or open the existing one. Vaults made with an older text passphrase keep a text field. */
export function Lock({ sealed, onOpen, onCreated }: {
  sealed: SealedVault | null;
  onOpen: (vk: VaultKey, data: VaultData) => void;
  onCreated: (sealed: SealedVault) => void;
}) {
  const [firstPin, setFirstPin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(secret: string): Promise<string | null> {
    if (!sealed) return "No wallet yet.";
    setBusy(true);
    setError(null);
    try {
      const { data, vk } = await unlock<VaultData>(sealed, secret);
      onOpen(vk, data);
      return null;
    } catch (err) {
      const msg = err instanceof WrongPassphraseError ? (sealed.pin ? "Wrong PIN." : err.message) : `Could not open the wallet: ${(err as Error).message}`;
      setError(msg);
      setBusy(false);
      return msg;
    }
  }

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
      const vk = await deriveKey(pin);
      const data: VaultData = { cards: [] };
      const s = await seal(data, vk);
      saveSealed(s);
      onCreated(s);
      onOpen(vk, data);
      return null;
    } catch (err) {
      setBusy(false);
      setError(`Could not create the wallet: ${(err as Error).message}`);
      return "failed";
    }
  }

  async function restore(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const s = await readSealedFile(file);
      saveSealed(s);
      onCreated(s);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const creating = !sealed;
  const title = creating ? (firstPin === null ? "Create a 9-digit PIN" : "Repeat your PIN") : "Wallet is locked";
  const hint = creating
    ? firstPin === null ? "Cards are encrypted with it on this device and never leave it." : "Enter the same nine digits again."
    : sealed.pin ? "Enter your 9-digit PIN." : "Enter your passphrase, then switch to a PIN in Settings.";

  return (
    <main className="lock">
      <div className="lock-card">
        <div className="lock-mark"><Icon name={creating ? "shield" : "lock"} size={26} /></div>
        <h1>{title}</h1>
        <p className="muted">{hint}</p>
        {creating || sealed.pin ? (
          <PinPad busy={busy} onComplete={creating ? create : open} />
        ) : (
          <LegacyForm busy={busy} onSubmit={open} />
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        {busy && <p className="fine"><span className="spinner dark" aria-hidden="true" /> {creating ? "Creating…" : "Unlocking…"}</p>}
        {creating ? (
          <>
            <p className="fine">There is no recovery. If you forget the PIN, the cards cannot be decrypted.</p>
            <label className="btn ghost block">
              <Icon name="upload" /> Restore from a backup
              <input type="file" accept="application/json,.json" hidden onChange={restore} />
            </label>
          </>
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
