import React, { useState } from "react";
import { deriveKey, seal, unlock, WrongPassphraseError, type SealedVault, type VaultKey } from "@shared/vault.ts";
import { readSealedFile, saveSealed, type VaultData } from "../store.ts";
import { Icon } from "../ui.tsx";

const MIN_LENGTH = 8;

/** Create a vault (new passphrase) or open the existing one. */
export function Lock({ sealed, onOpen, onCreated }: {
  sealed: SealedVault | null;
  onOpen: (vk: VaultKey, data: VaultData) => void;
  onCreated: (sealed: SealedVault) => void;
}) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creating = !sealed;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (creating) {
      if (pass.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);
      if (pass !== confirm) return setError("The two passphrases do not match.");
    }
    setBusy(true);
    try {
      if (sealed) {
        const { data, vk } = await unlock<VaultData>(sealed, pass);
        onOpen(vk, data);
      } else {
        const vk = await deriveKey(pass);
        const data: VaultData = { cards: [] };
        const s = await seal(data, vk);
        saveSealed(s);
        onCreated(s);
        onOpen(vk, data);
      }
    } catch (err) {
      setError(err instanceof WrongPassphraseError ? err.message : `Could not open the wallet: ${(err as Error).message}`);
      setBusy(false);
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
      setPass("");
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="lock">
      <div className="lock-card">
        <div className="lock-mark"><Icon name={creating ? "shield" : "lock"} size={26} /></div>
        <h1>{creating ? "Create your wallet" : "Wallet is locked"}</h1>
        <p className="muted">
          {creating
            ? "Pick a master passphrase. Cards are encrypted with it on this device and never leave it."
            : "Enter your master passphrase to unlock."}
        </p>
        <form onSubmit={submit} className="lock-form" autoComplete="off">
          <label className="field">
            <span>Master passphrase</span>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus autoComplete={creating ? "new-password" : "current-password"} />
          </label>
          {creating && (
            <label className="field">
              <span>Repeat passphrase</span>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </label>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn primary block" disabled={busy || !pass}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name={creating ? "check" : "key"} />}
            {busy ? (creating ? "Creating…" : "Unlocking…") : creating ? "Create wallet" : "Unlock"}
          </button>
        </form>
        {creating ? (
          <>
            <p className="fine">There is no recovery. If you forget the passphrase, the cards cannot be decrypted.</p>
            <label className="btn ghost block">
              <Icon name="upload" /> Restore from a backup
              <input type="file" accept="application/json,.json" hidden onChange={restore} />
            </label>
          </>
        ) : (
          <p className="fine"><Icon name="shield" size={14} /> AES-256-GCM · PBKDF2 600k · stored only on this device</p>
        )}
      </div>
    </main>
  );
}
