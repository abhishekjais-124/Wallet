import React, { useState } from "react";
import { digits } from "@shared/card.ts";
import { isPin, unlock, WrongPassphraseError, type SealedVault } from "@shared/vault.ts";
import { beginEnrol, bioErrorMessage, bioLabel, finishEnrol, nativeBio, type PendingEnrolment } from "../bio.ts";
import { Icon } from "../ui.tsx";

export const bioIcon = (): "touchid" | "faceid" => (bioLabel() === "Touch ID" ? "touchid" : "faceid");

/**
 * Two-tap set-up, because each biometric prompt must follow a tap: the first creates the passkey, the second gives
 * the secret that wraps the PIN. Without a known PIN (Settings after the offer was dismissed) it asks for it first.
 */
export function BioSetup({ pin, sealed, onDone, onCancel, compact }: {
  pin: string | null;
  sealed: SealedVault;
  onDone: () => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState<PendingEnrolment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = bioLabel();
  const secret = pin ?? typed;

  async function step1() {
    setError(null);
    setBusy(true);
    try {
      if (!pin) {
        if (!isPin(typed)) throw new Error("Enter your 9-digit PIN first.");
        await unlock(sealed, typed); // proves the PIN before a passkey is made for it
      }
      const p = await beginEnrol();
      if (nativeBio) {
        await finishEnrol(p, secret); // the app's own Face ID: one check is enough
        return onDone();
      }
      setPending(p);
    } catch (err) {
      setError(err instanceof WrongPassphraseError ? "Wrong PIN." : bioErrorMessage(err));
    }
    setBusy(false);
  }

  async function step2() {
    if (!pending) return;
    setError(null);
    setBusy(true);
    try {
      await finishEnrol(pending, secret);
      onDone();
    } catch (err) {
      setError(bioErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className={`bio-setup${compact ? " compact" : ""}`}>
      {!pin && !pending && (
        <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={9} placeholder="Your 9-digit PIN" value={typed}
          onChange={(e) => setTyped(digits(e.target.value))} autoComplete="off" aria-label="PIN" />
      )}
      <div className="actions-row">
        {pending ? (
          <button className="btn primary" onClick={step2} disabled={busy}><Icon name={bioIcon()} /> {busy ? "Checking…" : `Confirm with ${label}`}</button>
        ) : (
          <button className="btn primary" onClick={step1} disabled={busy || (!pin && !isPin(typed))}><Icon name={bioIcon()} /> {busy ? "Setting up…" : `Set up ${label}`}</button>
        )}
        {onCancel && <button className="btn ghost" onClick={onCancel} disabled={busy}>Not now</button>}
      </div>
      {pending && !error && <p className="fine">One more check: {label} asks again, then it is on.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
