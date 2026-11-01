/**
 * Share a card as a picture or as text. The picture is drawn here: the card is composed as one SVG (gradient or
 * photo, the drawn art, bank and network marks copied from the on-screen card, and the print as SVG text), then
 * placed on a soft framed canvas with a caption and exported as PNG. Only what the options allow is drawn;
 * by default the number is masked and the CVV is left out.
 */
import { formatNumber, inkFor, maskNumber, NETWORK_LABEL, type Card } from "@shared/card.ts";

export interface ShareOptions {
  fullNumber: boolean;
  expiry: boolean;
  holder: boolean;
  cvv: boolean;
}

export const DEFAULT_SHARE: ShareOptions = { fullNumber: false, expiry: true, holder: false, cvv: false };

const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const shareTitle = (card: Card) => `${card.nickname || card.bank}${card.nickname ? ` · ${card.bank}` : ""}`;
export const shareSubtitle = (card: Card) => `${NETWORK_LABEL[card.network]} ${card.kind === "credit" ? "credit" : "debit"} card`;

export function shareText(card: Card, o: ShareOptions): string {
  const lines = [shareTitle(card), shareSubtitle(card), `Card: ${o.fullNumber ? formatNumber(card.number, card.network) : maskNumber(card.number, card.network)}`];
  if (o.expiry) lines.push(`Valid thru: ${card.expiry}`);
  if (o.holder && card.holder) lines.push(`Name: ${card.holder}`);
  if (o.cvv && card.cvv) lines.push(`CVV: ${card.cvv}`);
  return lines.join("\n");
}

/** Copies an on-screen SVG (art, bank mark, network mark) into the picture at a given box. */
function part(el: Element | null, x: number, y: number, w: number, h: number, align = "xMidYMid meet"): string {
  if (!el) return "";
  const c = el.cloneNode(true) as SVGSVGElement;
  c.removeAttribute("class");
  Object.entries({ x, y, width: w, height: h }).forEach(([k, v]) => c.setAttribute(k, String(v)));
  if (!c.getAttribute("preserveAspectRatio") || align !== "xMidYMid meet") c.setAttribute("preserveAspectRatio", align);
  return new XMLSerializer().serializeToString(c);
}

const W = 640;
const H = 404;

function cardSvg(card: Card, o: ShareOptions, face: HTMLElement): string {
  const dark = inkFor(card.colors) === "dark" && !card.image;
  const ink = dark ? "#15161b" : "#ffffff";
  const ink2 = dark ? "rgba(21,22,27,0.62)" : "rgba(255,255,255,0.74)";
  const number = o.fullNumber ? formatNumber(card.number, card.network) : maskNumber(card.number, card.network);
  const art = face.querySelector(".cf-art");
  const mark = face.querySelector(".cf-mark");
  const net = face.querySelector(".cf-foot .cf-net");
  // `extra` may override fill or font-family; each attribute is written once (a repeat makes the SVG invalid)
  const t = (x: number, y: number, size: number, text: string, extra = "") =>
    `<text x="${x}" y="${y}" font-size="${size}"${/font-family=/.test(extra) ? "" : ` font-family="${FONT}"`}${/fill=/.test(extra) ? "" : ` fill="${ink}"`} ${extra}>${esc(text)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${card.colors[0]}"/><stop offset="1" stop-color="${card.colors[1]}"/></linearGradient>
    <radialGradient id="sheen" cx="1" cy="0" r="1.1"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.55" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <radialGradient id="shade" cx="0" cy="1" r="0.9"><stop offset="0" stop-color="#000" stop-opacity="0.22"/><stop offset="0.6" stop-color="#000" stop-opacity="0"/></radialGradient>
    <linearGradient id="veil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.42"/><stop offset="0.4" stop-color="#000" stop-opacity="0.1"/><stop offset="0.6" stop-color="#000" stop-opacity="0.12"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></linearGradient>
    <linearGradient id="chip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6e1a2"/><stop offset="0.5" stop-color="#d2a94e"/><stop offset="1" stop-color="#f1d68c"/></linearGradient>
    <clipPath id="clip"><rect width="${W}" height="${H}" rx="36"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
    ${card.image
      ? `<image href="${card.image}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/><rect width="${W}" height="${H}" fill="url(#veil)"/>`
      : `<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#shade)"/><g style="color:${ink}">${part(art, 0, 0, W, H, "xMidYMid slice")}</g>`}
    <rect width="${W}" height="${H}" fill="url(#sheen)"/>
    <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="36" fill="none" stroke="#fff" stroke-opacity="0.18"/>
  </g>
  ${part(mark, 42, 38, 44, 44)}
  ${t(98, 70, 30, card.bank, 'font-weight="700" letter-spacing="-0.4"')}
  ${t(W - 42, 68, 16, card.kind.toUpperCase(), `font-weight="700" letter-spacing="3.2" text-anchor="end" fill="${ink2}"`)}
  <rect x="42" y="118" width="74" height="56" rx="11" fill="url(#chip)" stroke="#000" stroke-opacity="0.18"/>
  <path transform="translate(42 118) scale(1.48)" d="M1 13h14m20 0h14M1 25h14m20 0h14M17 1v10a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4V1M17 37V27a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10" fill="none" stroke="rgba(80,55,10,.45)" stroke-width="1"/>
  <path transform="translate(136 128) scale(1.5)" d="M8.5 8.5a5 5 0 0 1 0 7M12 6a8.5 8.5 0 0 1 0 12M15.5 3.5a12 12 0 0 1 0 17" fill="none" stroke="${ink2}" stroke-width="2" stroke-linecap="round"/>
  ${t(42, 248, 38, number, `font-family="${MONO}" letter-spacing="4"`)}
  ${o.cvv && card.cvv ? t(42, 284, 15, `CVV  ${card.cvv}`, `font-family="${MONO}" letter-spacing="2" fill="${ink2}"`) : ""}
  ${o.holder && card.holder ? t(42, 322, 14, card.holder, `font-family="${MONO}" letter-spacing="2.4" fill="${ink2}"`) : ""}
  ${t(42, 358, 26, card.nickname, 'font-weight="650"')}
  ${o.expiry ? `${t(392, 330, 11, "VALID THRU", `font-weight="600" letter-spacing="2" fill="${ink2}"`)}${t(392, 358, 22, card.expiry, `font-family="${MONO}" font-weight="600" letter-spacing="1.5"`)}` : ""}
  ${part(net, W - 132, 326, 96, 42, "xMaxYMax meet")}
</svg>`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The card picture could not be drawn."));
    img.src = url;
  });
}

const rgba = (hex: string, a: number) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** The framed picture: soft backdrop in the card's colours, the card with a deep shadow, and a caption. */
export async function renderShareImage(card: Card, o: ShareOptions, face: HTMLElement): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([cardSvg(card, o, face)], { type: "image/svg+xml" }));
  try {
    const img = await loadImage(url);
    const CW = 1200;
    const CH = 960;
    const canvas = Object.assign(document.createElement("canvas"), { width: CW, height: CH });
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f4f5f9";
    ctx.fillRect(0, 0, CW, CH);
    for (const [hex, x, y, r, a] of [[card.colors[0], 160, 120, 640, 0.32], [card.colors[1], 1060, 860, 700, 0.28]] as const) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(hex, a));
      g.addColorStop(1, rgba(hex, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CW, CH);
    }
    const cw = 960;
    const ch = Math.round((cw * H) / W);
    const x = (CW - cw) / 2;
    const y = 104;
    ctx.save();
    ctx.shadowColor = "rgba(15, 18, 30, 0.38)";
    ctx.shadowBlur = 70;
    ctx.shadowOffsetY = 34;
    ctx.drawImage(img, x, y, cw, ch);
    ctx.restore();
    ctx.textAlign = "center";
    ctx.fillStyle = "#12141b";
    ctx.font = `700 46px ${FONT}`;
    ctx.fillText(shareTitle(card), CW / 2, y + ch + 112);
    ctx.fillStyle = "#6b7180";
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText(shareSubtitle(card), CW / 2, y + ch + 156);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The card picture could not be drawn.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
