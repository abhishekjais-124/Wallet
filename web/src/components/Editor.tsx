import React, { useState } from "react";
import {
  cvvLength, detectNetwork, digits, formatNumber, luhnValid, NETWORK_LABEL, normalizeExpiry,
  type Card, type CardKind, type Network,
} from "@shared/card.ts";
import { paletteFromImage, PRESETS } from "../palette.ts";
import { newId } from "../store.ts";
import { Icon, Segmented, Sheet } from "../ui.tsx";
import { CardFace } from "./CardFace.tsx";

export const CATEGORIES = ["Personal", "Business", "Travel", "Shopping", "Family"];

// password managers and browsers must not offer to save these fields
const noSave = { autoComplete: "off", "data-1p-ignore": true, "data-lpignore": "true", "data-form-type": "other" } as const;

export function Editor({ card, categories, onSave, onClose }: {
  card: Card | null;
  categories: string[];
  onSave: (card: Card) => Promise<void>;
  onClose: () => void;
}) {
  const [f, setF] = useState(() => ({
    bank: card?.bank ?? "",
    nickname: card?.nickname ?? "",
    holder: card?.holder ?? "",
    kind: card?.kind ?? ("credit" as CardKind),
    network: card?.network ?? ("other" as Network),
    networkTouched: !!card,
    number: card ? formatNumber(card.number, card.network) : "",
    expiry: card?.expiry ?? "",
    cvv: card?.cvv ?? "",
    category: card?.category ?? "Personal",
    colors: card?.colors ?? PRESETS[0]!.colors,
  }));
  const [cvvFocus, setCvvFocus] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  function onNumber(v: string) {
    const n = digits(v).slice(0, 19);
    setF((p) => {
      const network = p.networkTouched ? p.network : detectNetwork(n);
      return { ...p, number: formatNumber(n, network), network };
    });
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      set("colors", await paletteFromImage(file));
      setPhotoNote("Colours taken from your photo. The photo itself was not kept.");
    } catch {
      setPhotoNote("Could not read that image. Pick colours below instead.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const number = digits(f.number);
    const expiry = normalizeExpiry(f.expiry);
    if (!f.bank.trim()) errs.bank = "Add the bank name.";
    if (!f.holder.trim()) errs.holder = "Add the name printed on the card.";
    if (!luhnValid(number)) errs.number = "This card number is not valid. Check the digits.";
    if (!expiry) errs.expiry = "Use MM/YY.";
    if (f.cvv && !new RegExp(`^\\d{${cvvLength(f.network)}}$`).test(f.cvv)) errs.cvv = `${cvvLength(f.network)} digits.`;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const now = Date.now();
    try {
      await onSave({
        id: card?.id ?? newId(),
        bank: f.bank.trim(),
        nickname: f.nickname.trim(),
        holder: f.holder.trim().toUpperCase(),
        kind: f.kind,
        network: f.network,
        number,
        expiry: expiry!,
        cvv: f.cvv,
        category: f.category.trim() || "Personal",
        favorite: card?.favorite ?? false,
        colors: f.colors,
        createdAt: card?.createdAt ?? now,
        updatedAt: now,
      });
    } catch (err) {
      setErrors({ form: `Could not save: ${(err as Error).message}` });
      setBusy(false);
    }
  }

  const preview = { ...f, number: digits(f.number), expiry: normalizeExpiry(f.expiry) ?? f.expiry };
  return (
    <Sheet title={card ? "Edit card" : "Add a card"} onClose={onClose} wide>
      <form className="editor" onSubmit={submit} autoComplete="off" noValidate>
        <div className="editor-preview">
          <CardFace card={preview} reveal flippable flipped={cvvFocus} revealCvv />
        </div>
        <div className="editor-fields">
          <div className="grid2">
            <Field label="Bank" error={errors.bank}>
              <input value={f.bank} onChange={(e) => set("bank", e.target.value)} placeholder="HDFC Bank" {...noSave} />
            </Field>
            <Field label="Nickname">
              <input value={f.nickname} onChange={(e) => set("nickname", e.target.value)} placeholder="Travel card" {...noSave} />
            </Field>
          </div>
          <Field label="Card number" error={errors.number}>
            <input value={f.number} onChange={(e) => onNumber(e.target.value)} inputMode="numeric" placeholder="0000 0000 0000 0000" className="mono" {...noSave} />
          </Field>
          <div className="grid3">
            <Field label="Expiry" error={errors.expiry}>
              <input value={f.expiry} onChange={(e) => set("expiry", e.target.value)} onBlur={() => set("expiry", normalizeExpiry(f.expiry) ?? f.expiry)}
                inputMode="numeric" placeholder="MM/YY" maxLength={7} className="mono" {...noSave} />
            </Field>
            <Field label="CVV" error={errors.cvv}>
              <input type="password" value={f.cvv} onChange={(e) => set("cvv", digits(e.target.value).slice(0, 4))} inputMode="numeric"
                placeholder={"•".repeat(cvvLength(f.network))} className="mono" onFocus={() => setCvvFocus(true)} onBlur={() => setCvvFocus(false)} {...noSave} autoComplete="new-password" />
            </Field>
            <Field label="Network">
              <select value={f.network} onChange={(e) => setF((p) => ({ ...p, network: e.target.value as Network, networkTouched: true }))}>
                {Object.entries(NETWORK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Name on card" error={errors.holder}>
            <input value={f.holder} onChange={(e) => set("holder", e.target.value)} placeholder="A JAISWAL" {...noSave} />
          </Field>
          <div className="grid2">
            <div className="field">
              <span>Type</span>
              <Segmented label="Card type" value={f.kind} onChange={(v) => set("kind", v)}
                options={[{ value: "credit", label: "Credit" }, { value: "debit", label: "Debit" }]} />
            </div>
            <Field label="Category">
              <input value={f.category} onChange={(e) => set("category", e.target.value)} list="categories" {...noSave} />
              <datalist id="categories">{[...new Set([...CATEGORIES, ...categories])].map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
          </div>
          <div className="field">
            <span>Card design</span>
            <div className="design-row">
              <label className="btn sm">
                <Icon name="image" /> From a photo
                <input type="file" accept="image/*" hidden onChange={onPhoto} />
              </label>
              <input type="color" value={f.colors[0]} onChange={(e) => set("colors", [e.target.value, f.colors[1]])} aria-label="First colour" />
              <input type="color" value={f.colors[1]} onChange={(e) => set("colors", [f.colors[0], e.target.value])} aria-label="Second colour" />
            </div>
            <div className="swatches">
              {PRESETS.map((p) => (
                <button key={p.name} type="button" className="swatch" title={p.name} aria-label={p.name}
                  style={{ background: `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]})` }} onClick={() => set("colors", p.colors)} />
              ))}
            </div>
            {photoNote && <p className="fine">{photoNote}</p>}
          </div>
          {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
          <p className="fine"><Icon name="shield" size={14} /> No PIN is ever asked for or stored. CVV is optional and encrypted.</p>
          <div className="sheet-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy}>{busy ? "Saving…" : card ? "Save changes" : "Add card"}</button>
          </div>
        </div>
      </form>
    </Sheet>
  );
}

function Field({ label, error, children }: { label: string; error?: string | undefined; children: React.ReactNode }) {
  return (
    <label className={`field${error ? " invalid" : ""}`}>
      <span>{label}</span>
      {children}
      {error && <em className="field-error">{error}</em>}
    </label>
  );
}
