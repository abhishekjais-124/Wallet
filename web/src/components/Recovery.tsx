import React, { useState } from "react";
import { downloadText } from "../store.ts";
import { Icon, Sheet, useToast } from "../ui.tsx";

/** Shown once when a recovery key is made. It is not stored anywhere, so this is the only time it can be copied. */
export function RecoverySheet({ code, onDone }: { code: string; onDone: () => void }) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);

  return (
    <Sheet title="Your recovery key" onClose={() => saved && onDone()}>
      <div className="recovery">
        <p className="fine">Your Google Drive copy and backup files now open only with this key, not with the PIN. A new phone or
          computer asks for it once. Keep it in a password manager or on paper — it is not stored anywhere else.</p>
        <code className="recovery-code" aria-label="Recovery key">{code}</code>
        <div className="actions-row">
          <button className="btn" onClick={() => void navigator.clipboard.writeText(code).then(() => toast("Recovery key copied"))}>
            <Icon name="copy" /> Copy
          </button>
          <button className="btn" onClick={() => downloadText("wallet-recovery-key.txt", `Wallet recovery key\n\n${code}\n`)}>
            <Icon name="download" /> Save as file
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I saved it somewhere safe
        </label>
        <button className="btn primary block" disabled={!saved} onClick={onDone}>Done</button>
      </div>
    </Sheet>
  );
}

/** Text field for a recovery key: capitals, no autocorrect, grouped as typed. */
export function RecoveryInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input className="recovery-input" value={value} autoFocus={autoFocus} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
      autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="off" aria-label="Recovery key"
      onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24).replace(/(.{4})(?=.)/g, "$1-"))} />
  );
}
