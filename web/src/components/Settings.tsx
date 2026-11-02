import React, { useState } from "react";
import { digits, type Card } from "@shared/card.ts";
import { mergeById, type IdDoc } from "@shared/doc.ts";
import {
  createKeys, forRemote, isPin, isV2, newRecoveryKey, rewrapLocal, unlock, unlockWithRecovery, WrongPassphraseError, type SealedVault, type VaultKey,
} from "@shared/vault.ts";
import { exportBlobs, importBlobs } from "../blobs.ts";
import { downloadJson, readSealedFile, vaultOnly, type BackupFile, type ThemePref, type VaultData } from "../store.ts";
import { Icon, Segmented, Sheet, useToast } from "../ui.tsx";
import type { SyncState } from "../App.tsx";
import { nativeBio } from "../bio.ts";
import { bioIcon, BioSetup } from "./BioSetup.tsx";
import { RecoveryInput } from "./Recovery.tsx";

// iOS shows the number pad for inputmode="numeric" with a digits-only pattern
const pinInput = { inputMode: "numeric", pattern: "[0-9]*", maxLength: 9, autoComplete: "new-password" } as const;

export interface SyncControls extends SyncState {
  enabled: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onSyncNow: () => void;
}

export interface RecoveryControls {
  /** the wallet has a master key and recovery key (older vaults get one at the next PIN unlock) */
  on: boolean;
  onNew: () => Promise<void>;
  /** another device upgraded the wallet in Drive: join it with that recovery key */
  join: boolean;
  onJoin: (recovery: string, pin: string) => Promise<void>;
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

export function Settings({ theme, onTheme, lockMinutes, onLockMinutes, sealed, cards, docs, onReplace, onRekey, onErase, sync, bio, recovery, onClose }: {
  sync: SyncControls;
  bio: BioControls;
  recovery: RecoveryControls;
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
  lockMinutes: number;
  onLockMinutes: (m: number) => void;
  sealed: SealedVault;
  cards: Card[];
  docs: IdDoc[];
  onReplace: (cards: Card[], docs: IdDoc[]) => Promise<void>;
  onRekey: (vk: VaultKey, recovery?: string) => Promise<void>;
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
  const [joinForm, setJoinForm] = useState({ key: "", pin: "" });
  const [confirmNew, setConfirmNew] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  // a backup made since the recovery key opens with that key; older ones with the PIN they were made with
  const pendingRecovery = !!pending && isV2(pending);

  // the backup carries the encrypted ID files too, so it restores everything without Google Drive
  async function exportBackup() {
    setBusy(true);
    try {
      const blobs = await exportBlobs(docs.flatMap((d) => d.files));
      downloadJson(`wallet-backup-${new Date().toISOString().slice(0, 10)}.json`, { ...forRemote(sealed), blobs });
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
      const vault = vaultOnly(pending);
      const { data } = isV2(vault) ? await unlockWithRecovery<VaultData>(vault, importPass) : await unlock<VaultData>(vault, importPass);
      if (pending.blobs) await importBlobs(pending.blobs);
      // same card or document in both: the more recently edited copy wins
      const theirDocs = data.docs ?? [];
      await onReplace(mergeById(cards, data.cards), mergeById(docs, theirDocs));
      toast(`Imported ${data.cards.length} card${data.cards.length === 1 ? "" : "s"}${theirDocs.length ? ` and ${theirDocs.length} ID${theirDocs.length === 1 ? "" : "s"}` : ""}`);
      setPending(null);
      setImportPass("");
      setError(null);
    } catch (err) {
      setError({ where: "import", text: err instanceof WrongPassphraseError ? `That ${pendingRecovery ? "recovery key" : "PIN"} does not open this backup.` : (err as Error).message });
    }
    setBusy(false);
  }

  async function changePassphrase(e: React.FormEvent) {
    e.preventDefault();
    if (!isPin(pw.next)) return setError({ where: "pw", text: "The new PIN must be exactly 9 digits." });
    if (pw.next !== pw.repeat) return setError({ where: "pw", text: "The new PINs do not match." });
    setBusy(true);
    try {
      const { vk } = await unlock(sealed, pw.current);
      // same master key with a new PIN wrap; a vault from before the recovery key gets one now
      if (vk.raw) await onRekey(await rewrapLocal(vk, pw.next));
      else {
        const code = newRecoveryKey();
        await onRekey(await createKeys(pw.next, code), code);
      }
      toast("PIN changed");
      setPw({ current: "", next: "", repeat: "" });
      setError(null);
    } catch (err) {
      setError({ where: "pw", text: err instanceof WrongPassphraseError ? `The current ${sealed.pin ? "PIN" : "passphrase"} is wrong.` : (err as Error).message });
    }
    setBusy(false);
  }

  async function joinWallet(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await recovery.onJoin(joinForm.key, joinForm.pin);
      toast("Joined the wallet in Google Drive");
      setJoinForm({ key: "", pin: "" });
      setError(null);
    } catch (err) {
      setError({ where: "join", text: (err as Error).message });
    }
    setBusy(false);
  }

  async function newKey() {
    setBusy(true);
    try {
      await recovery.onNew();
      setConfirmNew(false);
    } catch (err) {
      setError({ where: "recovery", text: (err as Error).message });
    }
    setBusy(false);
  }

  const time = (at?: number) => new Date(at ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const syncStatus = sync.status === "syncing" ? "Syncing…" : sync.status === "ok" ? `Synced ${time(sync.at)}` : sync.message;
  const signedIn = sync.enabled && sync.status !== "off";

  return (
    <Sheet title="Settings" onClose={onClose}>
      <div className="settings">
        <Group>
          <Row icon={<Icon name={theme === "dark" ? "moon" : "sun"} size={18} />} title="Appearance">
            <Segmented label="Theme" value={theme} onChange={onTheme}
              options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
          </Row>
          <Row icon={<Icon name={bioIcon()} size={18} />} title={bio.label}
            sub={bio.enrolled ? "On for this device" : bio.available ? "Unlock without typing the PIN" : "Not available in this browser"}
            right={bio.enrolled ? <Switch on label={`Turn off ${bio.label}`} onChange={bio.onForget} />
              : bio.available ? <Switch on={false} label={`Set up ${bio.label}`} onChange={() => setBioOpen(!bioOpen)} /> : null}>
            {!bio.enrolled && bio.available && bioOpen && (
              <BioSetup pin={bio.pin} sealed={sealed} onDone={() => { bio.onEnrolled(); setBioOpen(false); toast(`${bio.label} unlock is on`); }} />
            )}
          </Row>
          <Row icon={<Icon name="clock" size={18} />} title="Auto-lock" sub="Also locks a minute after you leave the app">
            <Segmented label="Auto-lock" value={String(lockMinutes)} onChange={(v) => onLockMinutes(Number(v))}
              options={[{ value: "1", label: "1 min" }, { value: "5", label: "5 min" }, { value: "15", label: "15 min" }]} />
          </Row>
        </Group>

        {sync.enabled && (
          <Group label="Sync">
            {!signedIn ? (
              <Row icon={<GoogleMark />} title="Sync with Google" sub="Same cards on your phone and computer"
                right={<button className="btn sm primary" onClick={sync.onSignIn}>Sign in</button>} />
            ) : (
              <Row icon={<GoogleMark />} title={sync.email ?? "Google account"}
                sub={<><span className={`sync-dot ${sync.status}`} /> {syncStatus}</>}
                right={sync.status === "error" && sync.message?.includes("Sign in")
                  ? <button className="btn sm" onClick={sync.onSignIn}>Sign in</button>
                  : <button className="btn sm" onClick={sync.onSyncNow} disabled={sync.status === "syncing"}>Sync now</button>}>
                {recovery.join && (
                  <form className="inline-form" onSubmit={joinWallet} autoComplete="off">
                    <p className="fine">Enter the recovery key from your other device to keep syncing.</p>
                    <RecoveryInput value={joinForm.key} onChange={(key) => setJoinForm({ ...joinForm, key })} />
                    <input type="password" placeholder="PIN of this device" value={joinForm.pin} onChange={(e) => setJoinForm({ ...joinForm, pin: digits(e.target.value) })} {...pinInput} autoComplete="current-password" />
                    <button className="btn primary" disabled={busy || joinForm.key.length < 29 || !isPin(joinForm.pin)}><Icon name="key" /> Join and merge</button>
                    {error?.where === "join" && <p className="form-error" role="alert">{error.text}</p>}
                  </form>
                )}
              </Row>
            )}
          </Group>
        )}

        <Group label="Security and data">
          <Fold icon="lock" title={sealed.pin ? "Change PIN" : "Switch to a 9-digit PIN"} hint="Needs your current PIN">
            <form className="inline-form" onSubmit={changePassphrase} autoComplete="off">
              <input type="password" placeholder={sealed.pin ? "Current PIN" : "Current passphrase"} value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })} {...(sealed.pin ? pinInput : {})} autoComplete="current-password" />
              <input type="password" placeholder="New 9-digit PIN" value={pw.next} onChange={(e) => setPw({ ...pw, next: digits(e.target.value) })} {...pinInput} />
              <input type="password" placeholder="Repeat new PIN" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: digits(e.target.value) })} {...pinInput} />
              <button className="btn" disabled={busy || !pw.current || !pw.next}>{sealed.pin ? "Change PIN" : "Switch to PIN"}</button>
            </form>
            {error?.where === "pw" && <p className="form-error" role="alert">{error.text}</p>}
          </Fold>

          {recovery.on && (
            <Fold icon="key" title="Recovery key" hint="Opens your wallet on a new device">
              <p className="fine">Google Drive and backup files open only with the recovery key, never with the PIN. Lost it? Make a
                new one here; the old key stops working for new copies.</p>
              {confirmNew ? (
                <div className="actions-row">
                  <button className="btn primary" disabled={busy} onClick={() => void newKey()}>Make the new key</button>
                  <button className="btn ghost" onClick={() => setConfirmNew(false)}>Cancel</button>
                </div>
              ) : (
                <div className="actions-row"><button className="btn" onClick={() => setConfirmNew(true)}>Make a new recovery key</button></div>
              )}
              {error?.where === "recovery" && <p className="form-error" role="alert">{error.text}</p>}
            </Fold>
          )}

          <Fold icon="download" title="Backup and restore" hint="Save or load an encrypted file">
            <p className="fine">The file holds your cards and ID files, encrypted. It opens with the recovery key (older backups with
              the PIN they were made with).</p>
            <div className="actions-row">
              <button className="btn" disabled={busy} onClick={() => void exportBackup()}><Icon name="download" /> Export</button>
              <label className="btn">
                <Icon name="upload" /> Import
                <input type="file" accept="application/json,.json" hidden onChange={pickBackup} />
              </label>
            </div>
            {pending && (
              <form className="inline-form" onSubmit={mergeBackup}>
                <label className="field">
                  <span>{pendingRecovery ? "Recovery key" : pending.pin ? "PIN" : "Passphrase"} of the backup</span>
                  {pendingRecovery ? <RecoveryInput value={importPass} onChange={setImportPass} autoFocus />
                    : <input type="password" value={importPass} onChange={(e) => setImportPass(e.target.value)} autoFocus autoComplete="off" {...(pending.pin ? pinInput : {})} />}
                </label>
                <button className="btn primary" disabled={busy || !importPass}>Import cards</button>
              </form>
            )}
            {error?.where === "import" && <p className="form-error" role="alert">{error.text}</p>}
          </Fold>

          {signedIn && (
            <Fold icon="cloud" title="Google account" hint={sync.email ?? undefined}>
              <p className="fine">Signing out stops syncing on this device. Your cards stay here, and the copy in Drive stays there.</p>
              <div className="actions-row"><button className="btn" onClick={sync.onSignOut}>Sign out</button></div>
            </Fold>
          )}
        </Group>

        <Group>
          <Fold icon="trash" title="Erase wallet" hint="Delete everything on this device" danger>
            <p className="fine">Export a backup first if you want to keep your cards. Type ERASE to confirm.</p>
            <div className="inline-form">
              <input value={erase} onChange={(e) => setErase(e.target.value)} placeholder="ERASE" autoComplete="off" />
              <button className="btn danger" disabled={erase !== "ERASE"} onClick={onErase}><Icon name="trash" /> Erase everything</button>
            </div>
          </Fold>
        </Group>

        <p className="settings-foot"><Icon name="shield" size={13} /> AES-256-GCM · encrypted on this device</p>
      </div>
    </Sheet>
  );
}

type IconName = React.ComponentProps<typeof Icon>["name"];

function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <section className="group">
      {label && <h3>{label}</h3>}
      <div className="group-card">{children}</div>
    </section>
  );
}

function Row({ icon, title, sub, right, children }: {
  icon: React.ReactNode; title: string; sub?: React.ReactNode; right?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="set-row">
      <div className="set-main">
        <span className="set-icon">{icon}</span>
        <span className="set-text"><b>{title}</b>{sub && <small>{sub}</small>}</span>
        {right}
      </div>
      {children && <div className="set-below">{children}</div>}
    </div>
  );
}

/** A setting used now and then: one line until tapped. */
function Fold({ icon, title, hint, danger, children }: { icon: IconName; title: string; hint?: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <details className={`fold${danger ? " danger" : ""}`}>
      <summary className="set-main">
        <span className="set-icon"><Icon name={icon} size={18} /></span>
        <span className="set-text"><b>{title}</b>{hint && <small>{hint}</small>}</span>
        <span className="chev"><Icon name="chevron" size={18} /></span>
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: () => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch${on ? " on" : ""}`} onClick={onChange} />;
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
