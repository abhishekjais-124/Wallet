/**
 * Files attached to ID documents. Photos are shrunk to a sharp-but-small JPEG; PDFs are kept as they are, up to
 * 10 MB. New files arrive as data URLs and are moved into the encrypted blob store (blobs.ts) when the ID is saved.
 */
import { useEffect, useState } from "react";
import type { DocFile } from "@shared/doc.ts";
import { fileBlob } from "./blobs.ts";
import { newId } from "./store.ts";

const PHOTO_MAX = 1600;
export const PDF_MAX_BYTES = 10 * 1024 * 1024;

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
  if (file.size > PDF_MAX_BYTES) throw new Error(`That PDF is ${(file.size / 1048576).toFixed(1)} MB; the limit is 10 MB.`);
  return { id: newId(), name: file.name, type: "application/pdf", data: await readAsDataUrl(file), size: file.size };
}

export const toFile = async (f: DocFile) => new File([await fileBlob(f)], f.name, { type: f.type });

/** Opens a file in a new tab (PDF viewer or image). The tab is opened first, so Safari does not block it. */
export async function openFile(f: DocFile): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const url = URL.createObjectURL(await fileBlob(f));
    if (tab) tab.location.href = url;
    else Object.assign(document.createElement("a"), { href: url, target: "_blank", rel: "noopener" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

/** An object URL for a stored file (or its inline data), revoked when the component goes away. */
export function useFileUrl(f: DocFile | undefined): { url: string | null; error: string | null } {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: f?.data ?? null, error: null });
  useEffect(() => {
    if (!f) return setState({ url: null, error: null });
    if (f.data) return setState({ url: f.data, error: null });
    let alive = true;
    let url: string | null = null;
    fileBlob(f).then(
      (b) => { url = URL.createObjectURL(b); if (alive) setState({ url, error: null }); },
      (err: Error) => alive && setState({ url: null, error: err.message }),
    );
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [f?.id, f?.data, f?.key]);
  return state;
}

export const sizeLabel = (bytes: number) => (bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
