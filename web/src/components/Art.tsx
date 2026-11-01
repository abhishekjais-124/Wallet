import React from "react";

/**
 * Drawn card artwork: one lightweight SVG pattern per style, in the card's own ink, picked from the card's name
 * (Airtel → waves, SimplyCLICK → honeycomb, …) unless the card chose one. Our own drawings, not the banks' art.
 */
export const ART_STYLES = ["waves", "honeycomb", "arc", "monogram", "rays", "swoosh", "stripes", "ribbon", "mesh", "circles", "aurora", "dots"] as const;
export type ArtStyle = (typeof ART_STYLES)[number];

const BY_KEYWORD: [RegExp, ArtStyle][] = [
  [/airtel|vistara|wave/i, "waves"],
  [/simply|click|cashback|hex/i, "honeycomb"],
  [/amazon|smile|digibank|trip/i, "arc"],
  [/play|bookmyshow|zet|pop\b/i, "monogram"],
  [/pnb|rupay|sun|gold/i, "rays"],
  [/scapia|bpcl|indianoil|fuel|power/i, "swoosh"],
  [/platinum|titanium|wealth|easyshop|infinia|select/i, "stripes"],
  [/flipkart|myntra|ribbon|millennia/i, "ribbon"],
  [/811|phonepe|qr|tech|mesh/i, "mesh"],
  [/coral|eazydiner|diner|dine|regalia/i, "circles"],
  [/slice|swiggy|tata|neu|live\+|hsbc|aurora/i, "aurora"],
  [/dot|pixel|yes/i, "dots"],
];

export function artFor(nickname: string, bank: string, chosen?: string): ArtStyle {
  if (chosen && (ART_STYLES as readonly string[]).includes(chosen)) return chosen as ArtStyle;
  const hit = BY_KEYWORD.find(([re]) => re.test(nickname) || re.test(bank));
  if (hit) return hit[1];
  let h = 0;
  for (const ch of nickname + bank) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ART_STYLES[h % ART_STYLES.length]!;
}

// 320×202 is the card's own aspect; "slice" keeps the drawing edge to edge at any size
const frame = { viewBox: "0 0 320 202", preserveAspectRatio: "xMidYMid slice", className: "cf-art", "aria-hidden": true } as const;

const DRAWINGS: Record<ArtStyle, React.ReactNode> = {
  waves: (
    <g fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="round" opacity="0.14">
      <path d="M-20 150c60-70 110-70 170 0s110 70 190 0" />
      <path d="M-20 190c60-70 110-70 170 0s110 70 190 0" opacity="0.6" />
      <path d="M40 110c60-70 110-70 170 0s110 70 170 0" opacity="0.35" strokeWidth="8" />
    </g>
  ),
  honeycomb: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.2">
      <defs>
        <pattern id="art-hex" width="36" height="31" patternUnits="userSpaceOnUse" patternTransform="translate(180 20)">
          <path d="M18 0l17 10v21l-17 10L1 31V10z" />
        </pattern>
      </defs>
      <rect x="150" y="-10" width="200" height="230" fill="url(#art-hex)" stroke="none" />
    </g>
  ),
  arc: (
    <g fill="none" stroke="currentColor" strokeLinecap="round" opacity="0.18">
      <path d="M60 150c70 60 150 60 220-10" strokeWidth="16" />
      <path d="M262 126l24 18-30 6" strokeWidth="12" strokeLinejoin="round" />
    </g>
  ),
  monogram: null, // drawn in the component: needs the card's name
  rays: (
    <g stroke="currentColor" strokeWidth="18" opacity="0.1">
      {Array.from({ length: 9 }, (_, i) => {
        const a = (-10 + i * 16) * (Math.PI / 180);
        return <line key={i} x1="330" y1="-20" x2={330 - Math.cos(a) * 420} y2={-20 + Math.sin(a) * 420} />;
      })}
    </g>
  ),
  swoosh: (
    <g fill="currentColor" opacity="0.12">
      <path d="M-10 210C80 120 190 110 340 150v70H-10z" />
      <path d="M60 210c90-50 170-50 280-20v30H60z" opacity="0.7" />
    </g>
  ),
  stripes: (
    <g stroke="currentColor" strokeWidth="2" opacity="0.1">
      {Array.from({ length: 14 }, (_, i) => <line key={i} x1={130 + i * 18} y1="-10" x2={30 + i * 18} y2="215" />)}
    </g>
  ),
  ribbon: (
    <g fill="currentColor" opacity="0.13">
      <path d="M-10 60L340 -30v40L-10 100z" />
      <path d="M-10 130L340 40v26L-10 156z" opacity="0.7" />
      <path d="M90 215L340 150v30L120 215z" opacity="0.5" />
    </g>
  ),
  mesh: (
    <g fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.14">
      <defs>
        <pattern id="art-mesh" width="22" height="22" patternUnits="userSpaceOnUse">
          <path d="M22 0H0v22" />
        </pattern>
      </defs>
      <rect x="170" y="-10" width="180" height="230" fill="url(#art-mesh)" stroke="none" />
      <rect x="170" y="-10" width="180" height="230" fill="none" stroke="none" />
    </g>
  ),
  circles: (
    <g fill="none" stroke="currentColor" opacity="0.14">
      <circle cx="290" cy="40" r="60" strokeWidth="18" />
      <circle cx="290" cy="40" r="100" strokeWidth="10" opacity="0.6" />
      <circle cx="290" cy="40" r="140" strokeWidth="5" opacity="0.4" />
    </g>
  ),
  aurora: (
    <g fill="currentColor">
      <ellipse cx="270" cy="30" rx="120" ry="70" opacity="0.14" />
      <ellipse cx="80" cy="200" rx="140" ry="60" opacity="0.1" />
      <ellipse cx="300" cy="170" rx="90" ry="50" opacity="0.08" />
    </g>
  ),
  dots: (
    <g fill="currentColor" opacity="0.16">
      <defs>
        <pattern id="art-dots" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="7" cy="7" r="1.6" />
        </pattern>
      </defs>
      <rect x="160" y="-10" width="190" height="230" fill="url(#art-dots)" />
    </g>
  ),
};

export const Art = React.memo(function Art({ style, name }: { style: ArtStyle; name: string }) {
  if (style === "monogram") {
    const word = (name.trim().split(/\s+/).pop() ?? name).slice(0, 5).toUpperCase() || "CARD";
    return (
      <svg {...frame}>
        <text x="330" y="150" textAnchor="end" fontSize="120" fontWeight="900" fontStyle="italic" fill="currentColor" opacity="0.09"
          fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" letterSpacing="-6">{word}</text>
      </svg>
    );
  }
  return <svg {...frame}>{DRAWINGS[style]}</svg>;
});

export const ART_LABEL: Record<ArtStyle, string> = {
  waves: "Waves", honeycomb: "Honeycomb", arc: "Arc", monogram: "Monogram", rays: "Rays", swoosh: "Swoosh",
  stripes: "Stripes", ribbon: "Ribbon", mesh: "Mesh", circles: "Circles", aurora: "Aurora", dots: "Dots",
};
