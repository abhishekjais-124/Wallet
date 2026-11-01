/**
 * Reads the two main colours of a card photo so the digital card keeps the bank's look.
 * The photo is drawn to a tiny canvas in memory and dropped; it is never stored or uploaded.
 */
export async function paletteFromImage(file: File): Promise<[string, string]> {
  const bitmap = await createImageBitmap(file);
  const w = 64;
  const h = Math.max(1, Math.round((w * bitmap.height) / bitmap.width));
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width: w, height: h });
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const px = ctx.getImageData(0, 0, w, h).data;

  // 4-bit buckets per channel; centre pixels weigh more since the card usually fills the middle of the photo
  const buckets = new Map<number, { r: number; g: number; b: number; weight: number }>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i + 3]! < 128) continue;
      const [r, g, b] = [px[i]!, px[i + 1]!, px[i + 2]!];
      const centre = Math.max(0.02, 1 - Math.hypot(x / w - 0.5, y / h - 0.5) * 1.8) ** 2;
      const weight = centre * (0.4 + saturation(r, g, b));
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, weight: 0 };
      bucket.r += r * weight;
      bucket.g += g * weight;
      bucket.b += b * weight;
      bucket.weight += weight;
      buckets.set(key, bucket);
    }
  }
  const ranked = [...buckets.values()]
    .sort((a, b) => b.weight - a.weight)
    .map((c) => [c.r / c.weight, c.g / c.weight, c.b / c.weight] as const);
  const first = ranked[0] ?? ([40, 44, 60] as const);
  // the partner matches the card's colourfulness, so the table or wall behind the card is not picked
  const colourful = saturation(...first) > 0.25;
  const second = ranked.find((c) => distance(c, first) > 60 && (colourful ? saturation(...c) > 0.18 : saturation(...c) < 0.25))
    ?? first.map((v) => v * 0.55);
  return [hex(first), hex(second)];
}

/**
 * A photo of the card as a small JPEG for the card background: centre-cropped to the card's aspect, 640px wide
 * (~40–60 KB), so 50 cards with photos still fit the vault and sync.
 */
export async function cardPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const W = 640;
  const H = Math.round(W / 1.586);
  const scale = Math.max(W / bitmap.width, H / bitmap.height);
  const sw = W / scale;
  const sh = H / scale;
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width: W, height: H });
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, W, H);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const hex = (c: readonly number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

export const PRESETS: { name: string; colors: [string, string] }[] = [
  { name: "Midnight", colors: ["#1b2a4e", "#0a1022"] },
  { name: "Graphite", colors: ["#3a3d45", "#121316"] },
  { name: "Platinum", colors: ["#e6e8ec", "#a9afba"] },
  { name: "Gold", colors: ["#e8c77a", "#a77b2c"] },
  { name: "Ruby", colors: ["#a3203c", "#4a0b1c"] },
  { name: "Saffron", colors: ["#f08a24", "#a3361a"] },
  { name: "Ocean", colors: ["#1f7ae0", "#0b2f6b"] },
  { name: "Emerald", colors: ["#1c9a6c", "#0b3d2e"] },
  { name: "Violet", colors: ["#7b5cff", "#2b1a73"] },
];
