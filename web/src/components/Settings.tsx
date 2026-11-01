import React, { useState } from "react";
import { digits, type Card } from "@shared/card.ts";
import { mergeById, type IdDoc } from "@shared/doc.ts";
import { deriveKey, isPin, unlock, WrongPassphraseError, type SealedVault, type VaultKey } from "@shared/vault.ts";
import { exportBlobs, importBlobs } from "../blobs.ts";
import { downloadJson, readSealedFile, vaultOnly, type BackupFile, type ThemePref, type VaultData } from "../store.ts";
import { Icon, Segmented, Sheet, useToast } from "../ui.tsx";
import type { SyncState } from "../App.tsx";
import { BioSetup } from "./BioSetup.tsx";

// iOS shows the number pad for inputmode="numeric" with a digits-only pattern
const pinInput = { inputMode: "numeric", pattern: "[0-9]*", maxLength: 9, autoComplete: "new-password" } as const;

export interface SyncControls extends SyncState {
  enabled: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onSyncNow: () => void;
}

export interface BioControls {
  label: string;
  available: boolean;
  enrolled: boolean;
  pin: string | null;
  offer: boolean;
  onEnrolled: () => void;
  onForget: () => void;
  onDismissOffer: () => void;
}

export function Settings({ theme, onTheme, lockMinutes, onLockMinutes, sealed, cards, docs, onReplace, onRekey, onErase, sync, bio, onClose }: {
  sync: SyncControls;
  bio: BioControls;
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
  lockMinutes: number;
  onLockMinutes: (m: number) => void;
  sealed: SealedVault;
  cards: Card[];
  docs: IdDoc[];
  onReplace: (cards: Card[], docs: IdDoc[]) => Promise<void>;
  onRekey: (vk: VaultKey) => Promise<void>;
  onErase: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [importPass, setImportPass] = useState("");
  const [pw, setPw] = useState({ current: "", next: "", repeat: "" });
  const [erase, setErase] = useState("");
  const [error, setError] = useState<{ where: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // the backup carries the encrypted ID files too, so it restores everything without Google Drive
  async function exportBackup() {
    setBusy(true);
    try {
      const blobs = await exportBlobs(docs.flatMap((d) => d.files));
      downloadJson(`wallet-backup-${new Date().toISOString().slice(0, 10)}.json`, { ...sealed, blobs });
    } catch (err) {
      setError({ where: "import", text: `Could not export: ${(err as Error).message}` });
    }
    setBusy(false);
  }

  async function pickBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setPending(await readSealedFile(file));
      setError(null);
    } catch (err) {
      setError({ where: "import", text: (err as Error).message });
    }
  }

  async function mergeBackup(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setBusy(true);
    try {
      const { data } = await unlock<VaultData>(vaultOnly(pending), importPass);
      if (pending.blobs) await importBlobs(pending.blobs);
      // same card or document in both: the more recently edited copy wins
      const theirDocs = data.docs ?? [];
      await onReplace(mergeById(cards, data.cards), mergeById(docs, theirDocs));
      toast(`Imported ${data.cards.length} card${data.cards.length === 1 ? "" : "s"}${theirDocs.length ? ` and ${theirDocs.length} ID${theirDocs.length === 1 ? "" : "s"}` : ""}`);
      setPending(null);
      setImportPass("");
      setError(null);
    } catch (err) {
      setError({ where: "import", text: err instanceof WrongPassphraseError ? "That PIN does not open this backup." : (err as Error).message });
    }
    setBusy(false);
  }

  async function changePassphrase(e: React.FormEvent) {
    e.preventDefault();
    if (!isPin(pw.next)) return setError({ where: "pw", text: "The new PIN must be exactly 9 digits." });
    if (pw.next !== pw.repeat) return setError({ where: "pw", text: "The new PINs do not match." });
    setBusy(true);
    try {
      await unlock(sealed, pw.current);
      await onRekey(await deriveKey(pw.next));
      toast("PIN changed");
      setPw({ current: "", next: "", repeat: "" });
      setError(null);
    } catch (err) {
      setError({ where: "pw", text: err instanceof WrongPassphraseError ? `The current ${sealed.pin ? "PIN" : "passphrase"} is wrong.` : (err as Error).message });
    }
    setBusy(false);
  }

  return (
    <Sheet title="Settings" onClose={onClose}>
      <div className="settings">
        <section>
          <h3>Appearance</h3>
          <Segmented label="Theme" value={theme} onChange={onTheme}
            options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        </section>

        <section>
          <h3>{bio.label}</h3>
          {bio.enrolled ? (
            <>
              <p className="sync-line"><span className="sync-dot ok" /><span className="grow">{bio.label} unlock is on for this device.<br />
                <small>The PIN is wrapped by this device's passkey and never leaves it. Changing the PIN turns this off.</small></span></p>
              <div className="actions-row"><button className="btn" onClick={bio.onForget}>Turn off</button></div>
            </>
          ) : bio.available ? (
            <>
              <p className="fine">Unlock with {bio.label} instead of typing the PIN. The PIN stays the real key; it is stored on this device
                wrapped by a passkey that only opens after {bio.label}.</p>
              <BioSetup pin={bio.pin} sealed={sealed} onDone={() => { bio.onEnrolled(); toast(`${bio.label} unlock is on`); }} />
            </>
          ) : (
            <p className="fine">Not available in this browser. It needs a device with {bio.label} and a recent browser (iOS 18, Safari 18 or Chrome).</p>
          )}
        </section>

        <section>
          <h3>Auto-lock</h3>
          <p className="fine">Locks after this long without a tap, and whenever the app stays in the background for a minute.</p>
          <Segmented label="Auto-lock" value={String(lockMinutes)} onChange={(v) => onLockMinutes(Number(v))}
            options={[{ value: "1", label: "1 min" }, { value: "5", label: "5 min" }, { value: "15", label: "15 min" }]} />
        </section>

        {sync.enabled && (
          <section>
            <h3>Sync with Google</h3>
            {sync.status === "off" ? (
              <>
                <p className="fine">Keeps the same cards on your phone and computer. Only the encrypted vault is stored, in a hidden
                  app folder in your Google Drive. Each device still asks for your PIN.</p>
                <button className="btn" onClick={sync.onSignIn}><GoogleMark /> Sign in with Google</button>
              </>
            ) : (
              <>
                <p className="sync-line">
                  <span className={`sync-dot ${sync.status}`} />
                  <span className="grow">{sync.email ?? "Google account"}<br />
                    <small>{sync.status === "syncing" ? "Syncing…" : sync.status === "ok" ? `Synced ${new Date(sync.at ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : sync.message}</small>
                  </span>
                </p>
                <div className="actions-row">
                  {sync.status === "error" && sync.message?.includes("Sign in") ? (
                    <button className="btn" onClick={sync.onSignIn}><GoogleMark /> Sign in again</button>
                  ) : (
                    <button className="btn" onClick={sync.onSyncNow} disabled={sync.status === "syncing"}><Icon name="flip" /> Sync now</button>
                  )}
                  <button className="btn ghost" onClick={sync.onSignOut}>Sign out</button>
                </div>
              </>
            )}
          </section>
        )}

        <section>
          <h3>Backup</h3>
          <p className="fine">The backup file is the encrypted vault. It opens only with the PIN it was made with. Use it to move cards between devices or to keep a copy somewhere safe.</p>
          <div className="actions-row">
            <button className="btn" disabled={busy} onClick={() => void exportBackup()}>
              <Icon name="download" /> Export backup
            </button>
            <label className="btn">
              <Icon name="upload" /> Import backup
              <input type="file" accept="application/json,.json" hidden onChange={pickBackup} />
            </label>
          </div>
          {pending && (
            <form className="inline-form" onSubmit={mergeBackup}>
              <label className="field">
                <span>{pending.pin ? "PIN" : "Passphrase"} of the backup</span>
                <input type="password" value={importPass} onChange={(e) => setImportPass(e.target.value)} autoFocus autoComplete="off" {...(pending.pin ? pinInput : {})} />
              </label>
              <button className="btn primary" disabled={busy || !importPass}>Import cards</button>
            </form>
          )}
          {error?.where === "import" && <p className="form-error" role="alert">{error.text}</p>}
        </section>

        <section>
          <h3>{sealed.pin ? "Change PIN" : "Switch to a 9-digit PIN"}</h3>
          <form className="inline-form" onSubmit={changePassphrase} autoComplete="off">
            <input type="password" placeholder={sealed.pin ? "Current PIN" : "Current passphrase"} value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })} {...(sealed.pin ? pinInput : {})} autoComplete="current-password" />
            <input type="password" placeholder="New 9-digit PIN" value={pw.next} onChange={(e) => setPw({ ...pw, next: digits(e.target.value) })} {...pinInput} />
            <input type="password" placeholder="Repeat new PIN" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: digits(e.target.value) })} {...pinInput} />
            <button className="btn" disabled={busy || !pw.current || !pw.next}><Icon name="key" /> {sealed.pin ? "Change PIN" : "Switch to PIN"}</button>
          </form>
          {error?.where === "pw" && <p className="form-error" role="alert">{error.text}</p>}
        </section>

        <section className="danger-zone">
          <h3>Erase wallet</h3>
          <p className="fine">Deletes every card from this device. Export a backup first if you want to keep them. Type ERASE to confirm.</p>
          <div className="inline-form">
            <input value={erase} onChange={(e) => setErase(e.target.value)} placeholder="ERASE" autoComplete="off" />
            <button className="btn danger" disabled={erase !== "ERASE"} onClick={onErase}><Icon name="trash" /> Erase everything</button>
          </div>
        </section>
      </div>
    </Sheet>
  );
}

export function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
