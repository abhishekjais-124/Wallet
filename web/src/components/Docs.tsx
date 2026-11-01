import React, { useEffect, useState } from "react";
import {
  DOC_LABEL, DOC_TYPES, formatDocNumber, maskDocNumber, normalizeDate, normalizeDocNumber, validDocNumber,
  type DocFile, type DocType, type IdDoc,
} from "@shared/doc.ts";
import { forgetFile, storeFile } from "../blobs.ts";
import { openFile, pdfFile, photoFile, sizeLabel, toFile, useFileUrl } from "../files.ts";
import { newId } from "../store.ts";
import { Icon, Segmented, Sheet, useAutoHide, useCopy, useToast } from "../ui.tsx";
import { IdFace } from "./IdFace.tsx";

/** The IDs tab: one tile per document, then the detail, editor and share sheets. */
export function DocsView({ docs, save, adding, onAdded }: {
  docs: IdDoc[];
  save: (docs: IdDoc[]) => Promise<void>;
  adding: boolean;
  onAdded: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<IdDoc | "new" | null>(null);
  useEffect(() => { if (adding) { setEditing("new"); onAdded(); } }, [adding, onAdded]);

  // files live in the blob store (device + Drive), not in the vault: move older inline files there once
  useEffect(() => {
    if (!docs.some((d) => d.files.some((f) => f.data))) return;
    void Promise.all(docs.map(async (d) => ({ ...d, files: await Promise.all(d.files.map(storeFile)) }))).then(save);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const order: Record<DocType, number> = { aadhaar: 0, pan: 1, dl: 2 };
  const shown = [...docs].sort((a, b) => order[a.type] - order[b.type] || a.name.localeCompare(b.name));
  const open = docs.find((d) => d.id === openId) ?? null;
  const upsert = async (draft: IdDoc) => {
    const doc = { ...draft, files: await Promise.all(draft.files.map(storeFile)) };
    const before = docs.find((d) => d.id === doc.id)?.files ?? [];
    await save(docs.some((d) => d.id === doc.id) ? docs.map((d) => (d.id === doc.id ? doc : d)) : [...docs, doc]);
    for (const f of before) if (!doc.files.some((x) => x.id === f.id)) void forgetFile(f.id);
  };

  return (
    <>
      {docs.length === 0 ? (
        <div className="empty">
          <div className="empty-card"><IdFace doc={{ type: "aadhaar", name: "Your name", number: "", dob: "", files: [] }} /></div>
          <h2>No IDs yet</h2>
          <p className="muted">Keep your Aadhaar, PAN and driving licence here with a photo or the PDF of each. They are encrypted like your cards.</p>
          <button className="btn primary" onClick={() => setEditing("new")}><Icon name="plus" /> Add an ID</button>
        </div>
      ) : (
        <ul className="card-grid">
          {shown.map((d, i) => (
            <li key={d.id} style={{ "--i": i } as React.CSSProperties}>
              <IdFace doc={d} onClick={() => setOpenId(d.id)} label={`Open ${DOC_LABEL[d.type]} of ${d.name}`} />
            </li>
          ))}
        </ul>
      )}

      {open && (
        <DocDetail doc={open} onClose={() => setOpenId(null)} onEdit={() => { setEditing(open); setOpenId(null); }}
          onDelete={async () => { await save(docs.filter((d) => d.id !== open.id)); open.files.forEach((f) => void forgetFile(f.id)); setOpenId(null); }} />
      )}
      {editing && (
        <DocEditor doc={editing === "new" ? null : editing} onClose={() => setEditing(null)}
          onSave={async (doc) => { await upsert(doc); setEditing(null); setOpenId(doc.id); }} />
      )}
    </>
  );
}

function DocDetail({ doc, onEdit, onDelete, onClose }: { doc: IdDoc; onEdit: () => void; onDelete: () => void; onClose: () => void }) {
  const copy = useCopy();
  const toast = useToast();
  const [reveal, setReveal] = useAutoHide();
  const [sharing, setSharing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewing, setViewing] = useState<DocFile | null>(null);
  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  if (sharing) return <DocShare doc={doc} onClose={() => setSharing(false)} />;
  return (
    <Sheet title={DOC_LABEL[doc.type]} onClose={onClose}>
      <div className="detail">
        <div className="detail-card"><IdFace doc={doc} reveal={reveal} /></div>

        <div className="action-bar" role="toolbar" aria-label="ID actions">
          <button className="action is-share" onClick={() => setSharing(true)} aria-label="Share" title="Share"><Icon name="share" size={24} /></button>
          <button className="action is-edit" onClick={onEdit} aria-label="Edit" title="Edit"><Icon name="edit" size={24} /></button>
          <button className={`action is-danger${confirmDelete ? " armed" : ""}`} aria-label={confirmDelete ? "Tap again to delete" : "Delete"} title="Delete"
            onClick={() => { if (confirmDelete) onDelete(); else { setConfirmDelete(true); toast("Tap again to delete"); } }}>
            <Icon name={confirmDelete ? "check" : "trash"} size={24} />
          </button>
        </div>

        <div className="rows">
          <DocRow label="Name" value={doc.name} onCopy={() => copy(doc.name, "Name")} />
          <DocRow label={`${DOC_LABEL[doc.type]} number`} value={reveal ? formatDocNumber(doc.type, doc.number) : maskDocNumber(doc.type, doc.number)} mono
            onCopy={() => copy(doc.number, `${DOC_LABEL[doc.type]} number`, true)}>
            <button className="btn icon ghost" onClick={() => setReveal(!reveal)} aria-label={reveal ? "Hide number" : "Show number"} aria-pressed={reveal}>
              <Icon name={reveal ? "eyeOff" : "eye"} />
            </button>
          </DocRow>
          {doc.dob && <DocRow label="Date of birth" value={doc.dob} mono onCopy={() => copy(doc.dob, "Date of birth")} />}
          {doc.type === "dl" && doc.validTill && <DocRow label="Valid till" value={doc.validTill} mono />}
        </div>

        {doc.files.length > 0 && (
          <section className="doc-files">
            <h3>Files</h3>
            <div className="file-grid">
              {doc.files.map((f) => (
                <button key={f.id} className="file-tile" title={f.name}
                  onClick={() => (f.type.startsWith("image/") ? setViewing(f) : void openFile(f).catch((err: Error) => toast(err.message)))}>
                  <FileThumb file={f} />
                  <small>{sizeLabel(f.size)}</small>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      {viewing && (
        <div className="lightbox" onClick={() => setViewing(null)} role="dialog" aria-label={viewing.name}>
          <LightboxImage file={viewing} />
          <button className="btn icon lightbox-close" aria-label="Close"><Icon name="x" /></button>
        </div>
      )}
    </Sheet>
  );
}

function DocRow({ label, value, mono, onCopy, children }: { label: string; value: string; mono?: boolean; onCopy?: () => void; children?: React.ReactNode }) {
  return (
    <div className="row">
      <div className="row-text">
        <small>{label}</small>
        <span className={mono ? "mono" : undefined}>{value || "—"}</span>
      </div>
      <div className="row-actions">
        {children}
        {onCopy && <button className="btn icon ghost" onClick={onCopy} aria-label={`Copy ${label}`} title="Copy"><Icon name="copy" /></button>}
      </div>
    </div>
  );
}

function DocEditor({ doc, onSave, onClose }: { doc: IdDoc | null; onSave: (doc: IdDoc) => Promise<void>; onClose: () => void }) {
  const [f, setF] = useState(() => ({
    type: doc?.type ?? ("aadhaar" as DocType),
    name: doc?.name ?? "",
    number: doc?.number ?? "",
    dob: doc?.dob ?? "",
    validTill: doc?.validTill ?? "",
    files: doc?.files ?? ([] as DocFile[]),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  async function addFiles(e: React.ChangeEvent<HTMLInputElement>, kind: "photo" | "pdf") {
    const list = [...(e.target.files ?? [])];
    e.target.value = "";
    try {
      const added = await Promise.all(list.map((file) => (kind === "pdf" ? pdfFile(file) : photoFile(file))));
      setF((p) => ({ ...p, files: [...p.files, ...added] }));
      setErrors((p) => ({ ...p, files: "" }));
    } catch (err) {
      setErrors((p) => ({ ...p, files: (err as Error).message }));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const number = normalizeDocNumber(f.type, f.number);
    const dob = f.dob ? normalizeDate(f.dob) : "";
    const validTill = f.type === "dl" && f.validTill ? normalizeDate(f.validTill) : "";
    if (!f.name.trim()) errs.name = "Add the name as printed.";
    if (!validDocNumber(f.type, number)) {
      errs.number = f.type === "aadhaar" ? "Aadhaar has 12 digits and does not start with 0 or 1."
        : f.type === "pan" ? "PAN looks like ABCDE1234F." : "Check the licence number.";
    }
    if (dob === null) errs.dob = "Use DD/MM/YYYY.";
    if (validTill === null) errs.validTill = "Use DD/MM/YYYY.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const now = Date.now();
    try {
      await onSave({
        id: doc?.id ?? newId(),
        type: f.type,
        name: f.name.trim().toUpperCase(),
        number,
        dob: dob ?? "",
        ...(f.type === "dl" && validTill ? { validTill } : {}),
        files: f.files,
        createdAt: doc?.createdAt ?? now,
        updatedAt: now,
      });
    } catch (err) {
      const quota = (err as Error).name === "QuotaExceededError";
      setErrors({ form: quota ? "Not enough room on this device for these files. Remove a PDF or use photos instead." : `Could not save: ${(err as Error).message}` });
      setBusy(false);
    }
  }

  const preview = { ...f, number: normalizeDocNumber(f.type, f.number), validTill: f.validTill };
  return (
    <Sheet title={doc ? `Edit ${DOC_LABEL[f.type]}` : "Add an ID"} onClose={onClose} wide>
      <form className="editor" onSubmit={submit} autoComplete="off" noValidate>
        <div className="editor-preview"><IdFace doc={preview} reveal /></div>
        <div className="editor-fields">
          <div className="field">
            <span>Document</span>
            <Segmented label="Document" value={f.type} onChange={(v) => set("type", v)}
              options={DOC_TYPES.map((t) => ({ value: t, label: t === "dl" ? "Licence" : DOC_LABEL[t] }))} />
          </div>
          <label className={`field${errors.name ? " invalid" : ""}`}>
            <span>Name as printed</span>
            <input value={f.name} onChange={(e) => set("name", e.target.value)} autoComplete="off" />
            {errors.name && <em className="field-error">{errors.name}</em>}
          </label>
          <label className={`field${errors.number ? " invalid" : ""}`}>
            <span>{f.type === "dl" ? "Licence number" : `${DOC_LABEL[f.type]} number`}</span>
            <input className="mono" value={formatDocNumber(f.type, normalizeDocNumber(f.type, f.number))} onChange={(e) => set("number", e.target.value)}
              inputMode={f.type === "aadhaar" ? "numeric" : "text"} autoCapitalize="characters" autoComplete="off"
              placeholder={f.type === "aadhaar" ? "1234 5678 9012" : f.type === "pan" ? "ABCDE1234F" : "MH12 20110012345"} />
            {errors.number && <em className="field-error">{errors.number}</em>}
          </label>
          <div className="grid2">
            <label className={`field${errors.dob ? " invalid" : ""}`}>
              <span>Date of birth</span>
              <input className="mono" value={f.dob} onChange={(e) => set("dob", e.target.value)} onBlur={() => set("dob", normalizeDate(f.dob) ?? f.dob)}
                placeholder="DD/MM/YYYY" inputMode="numeric" autoComplete="off" />
              {errors.dob && <em className="field-error">{errors.dob}</em>}
            </label>
            {f.type === "dl" && (
              <label className={`field${errors.validTill ? " invalid" : ""}`}>
                <span>Valid till</span>
                <input className="mono" value={f.validTill} onChange={(e) => set("validTill", e.target.value)} onBlur={() => set("validTill", normalizeDate(f.validTill) ?? f.validTill)}
                  placeholder="DD/MM/YYYY" inputMode="numeric" autoComplete="off" />
                {errors.validTill && <em className="field-error">{errors.validTill}</em>}
              </label>
            )}
          </div>
          <div className="field">
            <span>Photos or PDF</span>
            <div className="design-row">
              <label className="btn sm"><Icon name="image" /> Add photos
                <input type="file" accept="image/*" multiple hidden onChange={(e) => void addFiles(e, "photo")} />
              </label>
              <label className="btn sm"><Icon name="file" /> Add PDF
                <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void addFiles(e, "pdf")} />
              </label>
            </div>
            {f.files.length > 0 && (
              <div className="file-grid">
                {f.files.map((file) => (
                  <div key={file.id} className="file-tile">
                    <FileThumb file={file} />
                    <small>{sizeLabel(file.size)}</small>
                    <button type="button" className="file-remove" aria-label={`Remove ${file.name}`} onClick={() => set("files", f.files.filter((x) => x.id !== file.id))}><Icon name="x" size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            {errors.files && <em className="field-error">{errors.files}</em>}
            <p className="fine">Front and back photos, or the PDF you downloaded (up to 10 MB). Files are encrypted on this device and kept in your Google Drive when you are signed in.</p>
          </div>
          {errors.form && <p className="form-error" role="alert">{errors.form}</p>}
          <div className="sheet-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy}>{busy ? "Saving…" : doc ? "Save changes" : "Add ID"}</button>
          </div>
        </div>
      </form>
    </Sheet>
  );
}

function DocShare({ doc, onClose }: { doc: IdDoc; onClose: () => void }) {
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = useCopy();
  const toast = useToast();
  const text = [
    `${DOC_LABEL[doc.type]} · ${doc.name}`,
    `Number: ${full ? formatDocNumber(doc.type, doc.number) : maskDocNumber(doc.type, doc.number)}`,
    ...(doc.dob ? [`DOB: ${doc.dob}`] : []),
    ...(doc.type === "dl" && doc.validTill ? [`Valid till: ${doc.validTill}`] : []),
  ].join("\n");

  async function shareFiles() {
    setBusy(true);
    try {
      const list = await Promise.all(doc.files.map(toFile));
      if (navigator.canShare?.({ files: list })) {
        await navigator.share({ files: list, title: `${DOC_LABEL[doc.type]} · ${doc.name}` });
      } else {
        for (const f of list) {
          const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(f), download: f.name });
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }
        toast(list.length === 1 ? "File saved" : "Files saved");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast((err as Error).message || "Could not share the files");
    }
    setBusy(false);
  }

  async function shareText() {
    if (!navigator.share) return copy(text, "Details", full);
    try {
      await navigator.share({ title: DOC_LABEL[doc.type], text });
    } catch (err) {
      if ((err as Error).name !== "AbortError") void copy(text, "Details", full);
    }
  }

  return (
    <Sheet title={`Share ${DOC_LABEL[doc.type]}`} onClose={onClose}>
      <div className="share">
        <div className="detail-card"><IdFace doc={doc} reveal={full} /></div>
        <div className="rows share-options">
          <label className="row switch-row">
            <span className="row-text"><span>Full number in text</span><small>Off shows only the last four</small></span>
            <input type="checkbox" className="switch" checked={full} onChange={(e) => setFull(e.target.checked)} />
          </label>
        </div>
        <p className="banner warn"><Icon name="shield" /> <span className="grow">ID copies are often misused. Share only with someone who needs it, and write the purpose on photocopies you hand over.</span></p>
        <div className="sheet-actions share-actions">
          <button className="btn ghost" onClick={() => void copy(text, "Details", full)}><Icon name="copy" /> Copy text</button>
          <button className="btn" onClick={() => void shareText()}><Icon name="share" /> Share as text</button>
          {doc.files.length > 0 && (
            <button className="btn primary" onClick={() => void shareFiles()} disabled={busy}>
              <Icon name="file" /> {busy ? "Sharing…" : doc.files.length === 1 ? (doc.files[0]!.type === "application/pdf" ? "Share PDF" : "Share photo") : `Share ${doc.files.length} files`}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function FileThumb({ file }: { file: DocFile }) {
  const { url, error } = useFileUrl(file.type.startsWith("image/") ? file : undefined);
  if (!file.type.startsWith("image/")) return <span className="file-pdf"><Icon name="file" size={26} />PDF</span>;
  if (url) return <img src={url} alt={file.name} />;
  return <span className="file-pdf" title={error ?? undefined}><Icon name={error ? "x" : "image"} size={22} />{error ? "Not here" : ""}</span>;
}

function LightboxImage({ file }: { file: DocFile }) {
  const { url, error } = useFileUrl(file);
  return url ? <img src={url} alt={file.name} /> : <p style={{ color: "#fff" }}>{error ?? "Loading…"}</p>;
}
