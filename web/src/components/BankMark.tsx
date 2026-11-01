import React from "react";

/**
 * Small, simplified bank marks drawn in each bank's colours (not the official artwork). A 24×24 tile; banks without
 * a drawn mark get a monogram tile.
 */
type Mark = { bg: string; glyph: React.ReactNode };

const text = (t: string, fill = "#fff", size = t.length > 2 ? 7.5 : 11) => (
  <text x="12" y="12" dy="0.36em" textAnchor="middle" fontSize={size} fontWeight="800" fill={fill}
    fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" letterSpacing="-0.3">{t}</text>
);

const MARKS: [RegExp, Mark][] = [
  [/hdfc/i, { bg: "#004c8f", glyph: <><rect x="6" y="6" width="12" height="12" fill="#fff" /><rect x="9" y="9" width="6" height="6" fill="#ed232a" /></> }],
  [/icici/i, {
    bg: "#b02a30",
    glyph: <><ellipse cx="12" cy="12" rx="5.6" ry="8" transform="rotate(28 12 12)" fill="#f58220" /><circle cx="13" cy="7.8" r="1.5" fill="#fff" /><path d="M12.4 10.4h1.9l-1.9 6.6h-1.9z" fill="#fff" /></>,
  }],
  [/axis/i, { bg: "#97144d", glyph: <path d="M12 5 19.5 19h-4.2L12 12.6 8.7 19H4.5z" fill="#fff" /> }],
  [/kotak/i, {
    bg: "#ed1c24",
    glyph: <path d="M5 12c0-2.1 1.5-3.4 3.2-3.4 3.2 0 4.4 6.8 7.6 6.8 1.7 0 3.2-1.3 3.2-3.4s-1.5-3.4-3.2-3.4c-3.2 0-4.4 6.8-7.6 6.8C6.5 15.4 5 14.1 5 12z" fill="none" stroke="#fff" strokeWidth="2.2" />,
  }],
  [/hsbc/i, {
    bg: "#fff",
    glyph: <><path d="M4 12 8 7h8l4 5-4 5H8z" fill="none" stroke="#db0011" strokeWidth="1.2" /><path d="M4 12 8 7v10zM20 12l-4-5v10z" fill="#db0011" /><path d="M8 7h8l-4 5zM8 17h8l-4-5z" fill="#db0011" opacity="0.25" /></>,
  }],
  [/idfc/i, { bg: "#9c1d26", glyph: <path d="M8 6h9v3h-6v2.5h5v3h-5V18H8z" fill="#fff" /> }],
  [/indusind/i, { bg: "#8b1d41", glyph: text("Ii") }],
  [/yes\s*bank/i, { bg: "#00518f", glyph: <>{text("YES", "#fff", 7.5)}<rect x="6" y="16.6" width="12" height="1.6" rx="0.8" fill="#e31e24" /></> }],
  [/rbl/i, { bg: "#21409a", glyph: text("RBL") }],
  [/punjab national|\bpnb\b/i, { bg: "#a20a3a", glyph: text("pnb", "#fbb034") }],
  [/baroda|bobcard/i, {
    bg: "#fff",
    glyph: <><circle cx="12" cy="12" r="7" fill="#f26522" />{text("b", "#fff", 11)}</>,
  }],
  [/dbs/i, { bg: "#fff", glyph: <path d="M12 3.5l2.6 5.9 5.9 2.6-5.9 2.6-2.6 5.9-2.6-5.9L3.5 12l5.9-2.6z" fill="#e21c24" /> }],
  [/sbm/i, { bg: "#0b4ea2", glyph: text("SBM") }],
  [/sbi/i, {
    bg: "#fff",
    glyph: <><circle cx="12" cy="12" r="7.5" fill="#1f4e9c" /><circle cx="12" cy="10.6" r="2" fill="#fff" /><rect x="11.1" y="11" width="1.8" height="7" fill="#fff" /></>,
  }],
];

const initials = (bank: string) =>
  bank.replace(/\b(bank|card|ltd|limited)\b/gi, "").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase() || "?";

export const BankMark = React.memo(function BankMark({ bank }: { bank: string }) {
  const mark = MARKS.find(([re]) => re.test(bank))?.[1] ?? { bg: "rgba(255,255,255,0.22)", glyph: text(initials(bank)) };
  return (
    <svg className="cf-mark" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill={mark.bg} />
      {mark.glyph}
    </svg>
  );
});
