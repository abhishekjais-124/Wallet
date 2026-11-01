import React, { useEffect, useState } from "react";
import { expiryState, formatNumber, last4, maskNumber, NETWORK_LABEL, type Card } from "@shared/card.ts";
import { Icon, Sheet, useAutoHide, useCopy } from "../ui.tsx";
import { CardFace } from "./CardFace.tsx";
import { ShareCard } from "./Share.tsx";

export function Detail({ card, onEdit, onToggleFavorite, onDelete, onClose }: {
  card: Card;
  onEdit: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const copy = useCopy();
  const [showNumber, setShowNumber] = useAutoHide();
  const [showCvv, setShowCvv] = useAutoHide();
  const [flipped, setFlipped] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sharing, setSharing] = useState(false);
  // "Confirm?" falls back to "Delete" after a few seconds (taps do not focus buttons on iPhone, so no blur to rely on)
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDelete]);
  const exp = expiryState(card.expiry);

  if (sharing) return <ShareCard card={card} onClose={() => setSharing(false)} />;

  return (
    <Sheet title={card.nickname || card.bank} onClose={onClose}>
      <div className="detail">
        <div className="detail-card">
          <CardFace card={card} flippable flipped={flipped} reveal={showNumber} revealCvv={showCvv} onClick={() => setFlipped((v) => !v)}
            label={flipped ? "Show the front" : "Show the back"} />
          <p className="fine center"><Icon name="flip" size={14} /> Tap the card to flip it</p>
        </div>

        <div className="action-bar" role="toolbar" aria-label="Card actions">
          <button className={`action${card.favorite ? " on" : ""}`} onClick={onToggleFavorite} aria-pressed={card.favorite}>
            <span className="action-icon"><Icon name="star" size={20} /></span>
            Favourite
          </button>
          <button className="action" onClick={() => setSharing(true)}>
            <span className="action-icon"><Icon name="share" size={20} /></span>Share
          </button>
          <button className="action" onClick={onEdit}>
            <span className="action-icon"><Icon name="edit" size={20} /></span>Edit
          </button>
          <button className={`action danger${confirmDelete ? " armed" : ""}`} onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
>
            <span className="action-icon"><Icon name="trash" size={20} /></span>{confirmDelete ? "Confirm?" : "Delete"}
          </button>
        </div>

        <div className="rows">
          <Row label="Card number" value={showNumber ? formatNumber(card.number, card.network) : maskNumber(card.number, card.network)} mono>
            <RevealButton on={showNumber} onToggle={() => setShowNumber(!showNumber)} what="card number" />
            <CopyButton onClick={() => copy(card.number, "Card number", true)} what="card number" />
          </Row>
          <Row label="Name on card" value={card.holder}>
            <CopyButton onClick={() => copy(card.holder, "Name")} what="name" />
          </Row>
          <Row label="Expiry" value={card.expiry} mono
            badge={exp === "expired" ? <span className="chip danger">Expired</span> : exp === "soon" ? <span className="chip warn">Expires soon</span> : null}>
            <CopyButton onClick={() => copy(card.expiry, "Expiry")} what="expiry" />
          </Row>
          {card.cvv && (
            <Row label="CVV" value={showCvv ? card.cvv : "•".repeat(card.cvv.length)} mono>
              <RevealButton on={showCvv} onToggle={() => { setShowCvv(!showCvv); setFlipped(!showCvv); }} what="CVV" />
              <CopyButton onClick={() => copy(card.cvv, "CVV", true)} what="CVV" />
            </Row>
          )}
          <Row label="Last four" value={last4(card.number)} mono>
            <CopyButton onClick={() => copy(last4(card.number), "Last four")} what="last four digits" />
          </Row>
          <Row label="Bank" value={card.bank}>
            <CopyButton onClick={() => copy(card.bank, "Bank")} what="bank" />
          </Row>
          <Row label="Network · type" value={`${NETWORK_LABEL[card.network]} · ${card.kind === "credit" ? "Credit" : "Debit"}`} />
          <Row label="Category" value={card.category} />
        </div>

      </div>
    </Sheet>
  );
}

function Row({ label, value, mono, badge, children }: { label: string; value: string; mono?: boolean; badge?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="row">
      <div className="row-text">
        <small>{label}</small>
        <span className={mono ? "mono" : undefined}>{value || "—"} {badge}</span>
      </div>
      <div className="row-actions">{children}</div>
    </div>
  );
}

function CopyButton({ onClick, what }: { onClick: () => void; what: string }) {
  return <button className="btn icon ghost" onClick={onClick} aria-label={`Copy ${what}`} title="Copy"><Icon name="copy" /></button>;
}

function RevealButton({ on, onToggle, what }: { on: boolean; onToggle: () => void; what: string }) {
  return (
    <button className="btn icon ghost" onClick={onToggle} aria-label={`${on ? "Hide" : "Show"} ${what}`} aria-pressed={on} title={on ? "Hide" : "Show"}>
      <Icon name={on ? "eyeOff" : "eye"} />
    </button>
  );
}
