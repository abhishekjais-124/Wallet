import React, { useEffect, useRef, useState } from "react";
import type { Card } from "@shared/card.ts";
import { DEFAULT_SHARE, renderShareImage, shareText, shareTitle, type ShareOptions } from "../share.ts";
import { Icon, Sheet, useCopy, useToast } from "../ui.tsx";
import { CardFace } from "./CardFace.tsx";

const OPTIONS: { key: keyof ShareOptions; label: string; hint: string }[] = [
  { key: "fullNumber", label: "Full card number", hint: "Off shows only the last four digits" },
  { key: "expiry", label: "Expiry", hint: "Valid thru month and year" },
  { key: "holder", label: "Name on card", hint: "" },
  { key: "cvv", label: "CVV", hint: "Never needed to receive money" },
];

export function ShareCard({ card, onClose }: { card: Card; onClose: () => void }) {
  const [o, setO] = useState<ShareOptions>(DEFAULT_SHARE);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const face = useRef<HTMLDivElement>(null);
  const blob = useRef<Blob | null>(null);
  const toast = useToast();
  const copy = useCopy();
  const risky = o.fullNumber || o.cvv;
  const fileName = `${(card.nickname || card.bank).replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "card"}.png`;

  // redraw the picture whenever an option changes; the hidden card face supplies the art and marks
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setError(null);
    renderShareImage(card, o, face.current!).then(
      (b) => {
        if (!alive) return;
        blob.current = b;
        url = URL.createObjectURL(b);
        setPreview(url);
      },
      (err: Error) => alive && setError(err.message),
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [card, o]);

  async function shareImage() {
    if (!blob.current) return;
    setBusy(true);
    const file = new File([blob.current], fileName, { type: "image/png" });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: shareTitle(card) });
      } else {
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: fileName });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast("Picture saved");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast("Could not share the picture");
    }
    setBusy(false);
  }

  async function shareAsText() {
    const text = shareText(card, o);
    if (!navigator.share) return copy(text, "Card details", risky);
    try {
      await navigator.share({ title: shareTitle(card), text });
    } catch (err) {
      if ((err as Error).name !== "AbortError") void copy(text, "Card details", risky);
    }
  }

  return (
    <Sheet title="Share card" onClose={onClose}>
      <div className="share">
        <div className="share-preview">
          {preview ? <img src={preview} alt={`Picture of ${shareTitle(card)}`} /> : <div className="share-wait">{error ?? "Drawing…"}</div>}
        </div>
        <div className="share-source" aria-hidden="true" ref={face}>
          <CardFace card={card} />
        </div>

        <div className="rows share-options">
          {OPTIONS.map(({ key, label, hint }) => (
            <label key={key} className={`row switch-row${key === "cvv" && !card.cvv ? " disabled" : ""}`}>
              <span className="row-text">
                <span>{label}</span>
                {hint && <small>{hint}</small>}
              </span>
              <input type="checkbox" className="switch" checked={o[key]} disabled={key === "cvv" && !card.cvv}
                onChange={(e) => setO((p) => ({ ...p, [key]: e.target.checked }))} />
            </label>
          ))}
        </div>

        {risky && (
          <p className="banner warn"><Icon name="shield" /> <span className="grow">Anyone who gets this can use the card for online payments. Share it only with someone you trust, and only if they need it.</span></p>
        )}

        <div className="sheet-actions share-actions">
          <button className="btn ghost" onClick={() => void copy(shareText(card, o), "Card details", risky)}><Icon name="copy" /> Copy text</button>
          <button className="btn" onClick={() => void shareAsText()}><Icon name="share" /> Share as text</button>
          <button className="btn primary" onClick={() => void shareImage()} disabled={busy || !preview}><Icon name="image" /> {busy ? "Sharing…" : "Share picture"}</button>
        </div>
      </div>
    </Sheet>
  );
}
