import React from "react";
import { cvvLength, formatNumber, inkFor, maskNumber, type Card, type Network } from "@shared/card.ts";
import { BankMark } from "./BankMark.tsx";

export type FaceCard = Pick<Card, "bank" | "nickname" | "kind" | "network" | "number" | "expiry" | "cvv" | "colors">;

/**
 * A realistic card: front with chip, number and network mark; back with stripe and CVV panel. Sized by its container.
 * Only `flippable` faces build the back and the 3D layers, so a long list stays a stack of flat, cheap cards.
 */
export const CardFace = React.memo(function CardFace({ card, flippable = false, flipped = false, reveal = false, revealCvv = false, onClick, label }: {
  card: FaceCard;
  flippable?: boolean;
  flipped?: boolean;
  reveal?: boolean;
  revealCvv?: boolean;
  onClick?: () => void;
  label?: string;
}) {
  const style = { "--c1": card.colors[0], "--c2": card.colors[1] } as React.CSSProperties;
  const number = card.number ? (reveal ? formatNumber(card.number, card.network) : maskNumber(card.number, card.network)) : "•••• •••• •••• ••••";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`cardface${flippable ? " flippable" : ""}${flipped ? " flipped" : ""}`} style={style} data-ink={inkFor(card.colors)} onClick={onClick}
      aria-label={label} type={onClick ? "button" : undefined}>
      <div className="cf-inner">
        <div className="cf-side cf-front">
          <div className="cf-row">
            <span className="cf-brand">
              {card.bank && <BankMark bank={card.bank} />}
              <span className="cf-bank">{card.bank || "Your bank"}</span>
            </span>
            <span className="cf-kind">{card.kind}</span>
          </div>
          <div className="cf-row cf-chiprow">
            <Chip />
            <Contactless />
          </div>
          <div className="cf-number">{number}</div>
          <div className="cf-row cf-foot">
            {/* the holder is the same on every card, so the face shows the card's own name instead */}
            <div className="cf-product">{card.nickname}</div>
            <div className="cf-field">
              <small>Valid thru</small>
              <span>{card.expiry || "MM/YY"}</span>
            </div>
            <NetworkMark network={card.network} />
          </div>
        </div>
        {flippable && <div className="cf-side cf-back" aria-hidden={!flipped}>
          <div className="cf-stripe" />
          <div className="cf-sign">
            <span className="cf-sign-strip" />
            <span className="cf-cvv">{card.cvv ? (revealCvv ? card.cvv : "•".repeat(card.cvv.length)) : "•".repeat(cvvLength(card.network))}</span>
          </div>
          <div className="cf-row cf-backfoot">
            <span className="cf-bank small">{card.bank}</span>
            <NetworkMark network={card.network} />
          </div>
        </div>}
      </div>
    </Tag>
  );
});

// the gold fill is a CSS gradient on the svg, so fifty cards do not repeat one gradient id fifty times
function Chip() {
  return (
    <svg className="cf-chip" viewBox="0 0 50 38" aria-hidden="true">
      <path d="M1 13h14m20 0h14M1 25h14m20 0h14M17 1v10a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4V1M17 37V27a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10" fill="none" stroke="rgba(80,55,10,.45)" strokeWidth="1.3" />
    </svg>
  );
}

function Contactless() {
  return (
    <svg className="cf-nfc" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8.5 8.5a5 5 0 0 1 0 7M12 6a8.5 8.5 0 0 1 0 12M15.5 3.5a12 12 0 0 1 0 17" />
    </svg>
  );
}

export function NetworkMark({ network }: { network: Network }) {
  switch (network) {
    case "visa":
      return (
        <svg className="cf-net" viewBox="0 0 64 22" aria-label="Visa">
          <text x="0" y="19" fontSize="22" fontWeight="900" fontStyle="italic" letterSpacing="-0.5" fill="currentColor" fontFamily="Arial, Helvetica, sans-serif">VISA</text>
        </svg>
      );
    case "mastercard":
    case "maestro":
      return (
        <svg className="cf-net" viewBox="0 0 48 30" aria-label={network === "maestro" ? "Maestro" : "Mastercard"}>
          <circle cx="17" cy="15" r="13" fill={network === "maestro" ? "#0099df" : "#eb001b"} />
          <circle cx="31" cy="15" r="13" fill={network === "maestro" ? "#e7001b" : "#f79e1b"} />
          <path d="M24 4.2a13 13 0 0 1 0 21.6 13 13 0 0 1 0-21.6Z" fill={network === "maestro" ? "#6c6bbd" : "#ff5f00"} />
        </svg>
      );
    case "rupay":
      return (
        <svg className="cf-net" viewBox="0 0 76 22" aria-label="RuPay">
          <text x="0" y="18" fontSize="19" fontWeight="900" fontStyle="italic" fill="currentColor" fontFamily="Arial, Helvetica, sans-serif">RuPay</text>
          <path d="M64 3l9 8-9 8z" fill="#f47920" />
          <path d="M59 5l7 6-7 6z" fill="#14853f" />
        </svg>
      );
    case "amex":
      return (
        <svg className="cf-net" viewBox="0 0 50 30" aria-label="American Express">
          <rect width="50" height="30" rx="4" fill="#1f72cd" />
          <text x="25" y="19.5" fontSize="11" fontWeight="900" textAnchor="middle" fill="#fff" fontFamily="Arial, Helvetica, sans-serif">AMEX</text>
        </svg>
      );
    case "other":
      return null;
    default:
      return (
        <span className="cf-net cf-net-text">{{ diners: "Diners Club", discover: "DISCOVER", jcb: "JCB" }[network]}</span>
      );
  }
}
