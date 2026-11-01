import React, { useState } from "react";
import type { Card } from "@shared/card.ts";
import { deriveKey, seal, unlock, WrongPassphraseError, type SealedVault, type VaultKey } from "@shared/vault.ts";
import { downloadJson, readSealedFile, type ThemePref, type VaultData } from "../store.ts";
import { Icon, Segmented, Sheet, useToast } from "../ui.tsx";

export function Settings({ theme, onTheme, lockMinutes, onLockMinutes, sealed, cards, onReplace, onRekey, onErase, onClose }: {
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
  lockMinutes: number;
  onLockMinutes: (m: number) => void;
  sealed: SealedVault;
  cards: Card[];
  onReplace: (cards: Card[]) => Promise<void>;
  onRekey: (vk: VaultKey) => Promise<void>;
  onErase: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [pending, setPending] = useState<SealedVault | null>(null);
  const [importPass, setImportPass] = useState("");
  const [pw, setPw] = useState({ current: "", next: "", repeat: "" });
  const [erase, setErase] = useState("");
  const [error, setError] = useState<{ where: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

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
      const { data } = await unlock<VaultData>(pending, importPass);
      // same card in both: the more recently edited copy wins
      const byId = new Map(cards.map((c) => [c.id, c]));
      for (const c of data.cards) if ((byId.get(c.id)?.updatedAt ?? -1) < c.updatedAt) byId.set(c.id, c);
      await onReplace([...byId.values()]);
      toast(`Imported ${data.cards.length} card${data.cards.length === 1 ? "" : "s"}`);
      setPending(null);
      setImportPass("");
      setError(null);
    } catch (err) {
      setError({ where: "import", text: err instanceof WrongPassphraseError ? "That passphrase does not open this backup." : (err as Error).message });
    }
    setBusy(false);
  }

  async function changePassphrase(e: React.FormEvent) {
    e.preventDefault();
    if (pw.next.length < 8) return setError({ where: "pw", text: "Use at least 8 characters." });
    if (pw.next !== pw.repeat) return setError({ where: "pw", text: "The new passphrases do not match." });
    setBusy(true);
    try {
      await unlock(sealed, pw.current);
      await onRekey(await deriveKey(pw.next));
      toast("Passphrase changed");
      setPw({ current: "", next: "", repeat: "" });
      setError(null);
    } catch (err) {
      setError({ where: "pw", text: err instanceof WrongPassphraseError ? "The current passphrase is wrong." : (err as Error).message });
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
          <h3>Auto-lock</h3>
          <p className="fine">Locks after this long without a tap, and whenever the app stays in the background for a minute.</p>
          <Segmented label="Auto-lock" value={String(lockMinutes)} onChange={(v) => onLockMinutes(Number(v))}
            options={[{ value: "1", label: "1 min" }, { value: "5", label: "5 min" }, { value: "15", label: "15 min" }]} />
        </section>

        <section>
          <h3>Backup</h3>
          <p className="fine">The backup file is the encrypted vault. It opens only with the passphrase it was made with. Use it to move cards between devices.</p>
          <div className="actions-row">
            <button className="btn" onClick={() => downloadJson(`wallet-backup-${new Date().toISOString().slice(0, 10)}.json`, sealed)}>
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
                <span>Passphrase of the backup</span>
                <input type="password" value={importPass} onChange={(e) => setImportPass(e.target.value)} autoFocus autoComplete="off" />
              </label>
              <button className="btn primary" disabled={busy || !importPass}>Import cards</button>
            </form>
          )}
          {error?.where === "import" && <p className="form-error" role="alert">{error.text}</p>}
        </section>

        <section>
          <h3>Change passphrase</h3>
          <form className="inline-form" onSubmit={changePassphrase} autoComplete="off">
            <input type="password" placeholder="Current passphrase" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
            <input type="password" placeholder="New passphrase" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
            <input type="password" placeholder="Repeat new passphrase" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} autoComplete="new-password" />
            <button className="btn" disabled={busy || !pw.current || !pw.next}><Icon name="key" /> Change</button>
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
