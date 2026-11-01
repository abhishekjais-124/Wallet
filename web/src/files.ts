/**
 * Files attached to ID documents. Photos are shrunk to a sharp-but-small JPEG; PDFs are kept as they are, up to a
 * limit, because everything lives inside the encrypted vault in browser storage (a few MB in all).
 */
import type { DocFile } from "@shared/doc.ts";
import { newId } from "./store.ts";

const PHOTO_MAX = 1600;
export const PDF_MAX_BYTES = 2.5 * 1024 * 1024;

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read that file."));
    r.readAsDataURL(blob);
  });

export async function photoFile(file: File): Promise<DocFile> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const data = canvas.toDataURL("image/jpeg", 0.82);
  return { id: newId(), name: file.name.replace(/\.[^.]+$/, "") + ".jpg", type: "image/jpeg", data, size: Math.round((data.length * 3) / 4) };
}

export async function pdfFile(file: File): Promise<DocFile> {
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) throw new Error("That is not a PDF.");
  if (file.size > PDF_MAX_BYTES) throw new Error(`That PDF is ${(file.size / 1048576).toFixed(1)} MB; the limit is 2.5 MB. Try a photo instead.`);
  return { id: newId(), name: file.name, type: "application/pdf", data: await readAsDataUrl(file), size: file.size };
}

export function toBlob(f: DocFile): Blob {
  const [, b64 = ""] = f.data.split(",");
  return new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: f.type });
}

export const toFile = (f: DocFile) => new File([toBlob(f)], f.name, { type: f.type });

/** Opens a file in a new tab (PDF viewer or image) from a short-lived blob URL. */
export function openFile(f: DocFile): void {
  const url = URL.createObjectURL(toBlob(f));
  const a = Object.assign(document.createElement("a"), { href: url, target: "_blank", rel: "noopener" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const sizeLabel = (bytes: number) => (bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
