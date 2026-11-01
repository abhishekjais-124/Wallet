import React from "react";
import { DOC_LABEL, DOC_SUBTITLE, formatDocNumber, maskDocNumber, type IdDoc } from "@shared/doc.ts";

export type FaceDoc = Pick<IdDoc, "type" | "name" | "number" | "dob" | "validTill" | "files">;

/**
 * An ID document drawn as a card in its own colours: Aadhaar on white with saffron and green bands, PAN in blue,
 * the driving licence in teal. Our own drawing, not the government designs; sized by its container like CardFace.
 */
export const IdFace = React.memo(function IdFace({ doc, reveal = false, onClick, label }: {
  doc: FaceDoc;
  reveal?: boolean;
  onClick?: () => void;
  label?: string;
}) {
  const Tag = onClick ? "button" : "div";
  const number = doc.number ? (reveal ? formatDocNumber(doc.type, doc.number) : maskDocNumber(doc.type, doc.number)) : "—";
  const photo = doc.files.find((f) => f.type.startsWith("image/"));
  const pdfs = doc.files.filter((f) => f.type === "application/pdf").length;
  const photos = doc.files.length - pdfs;
  const initials = doc.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return (
    <Tag className={`idface is-${doc.type}`} onClick={onClick} aria-label={label} type={onClick ? "button" : undefined}>
      <div className="id-inner">
        <div className="id-band" />
        <div className="id-head">
          <DocMark type={doc.type} />
          <div className="id-title">
            <strong>{DOC_LABEL[doc.type]}</strong>
            <small>{DOC_SUBTITLE[doc.type]}</small>
          </div>
        </div>
        <div className="id-body">
          <div className="id-avatar" aria-hidden="true">
            {photo ? <img src={photo.data} alt="" draggable={false} /> : <span>{initials}</span>}
          </div>
          <div className="id-fields">
            <span className="id-name">{doc.name || "Your name"}</span>
            <span className="id-number">{number}</span>
            <span className="id-meta">
              {doc.dob && <span><small>DOB</small> {doc.dob}</span>}
              {doc.type === "dl" && doc.validTill && <span><small>Valid till</small> {doc.validTill}</span>}
            </span>
          </div>
        </div>
        {doc.files.length > 0 && (
          <span className="id-files">{[pdfs && `${pdfs} PDF`, photos && `${photos} photo${photos === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
        )}
      </div>
    </Tag>
  );
});

/** Small marks drawn for this app: a sunburst for Aadhaar, a PAN monogram, a steering wheel for the licence. */
export function DocMark({ type }: { type: IdDoc["type"] }) {
  if (type === "aadhaar") {
    return (
      <svg className="id-mark" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="15" fill="#fff" stroke="#f0a24a" strokeWidth="1.5" />
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1="16" y1="5" x2="16" y2="9" stroke="#e46d2a" strokeWidth="1.8" strokeLinecap="round" transform={`rotate(${i * 30} 16 16)`} />
        ))}
        <circle cx="16" cy="16" r="4.6" fill="none" stroke="#c8102e" strokeWidth="1.8" />
        <path d="M11 22.5c3 2 7 2 10 0" fill="none" stroke="#138808" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "pan") {
    return (
      <svg className="id-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="8" fill="#fff" fillOpacity="0.16" stroke="#fff" strokeOpacity="0.5" />
        <text x="16" y="20.5" textAnchor="middle" fontSize="11" fontWeight="800" fill="#fff" fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" letterSpacing="0.4">PAN</text>
      </svg>
    );
  }
  return (
    <svg className="id-mark" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="#fff" fillOpacity="0.16" stroke="#fff" strokeOpacity="0.55" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="#fff" strokeWidth="2.2" />
      <circle cx="16" cy="16" r="2.4" fill="#fff" />
      <path d="M7.8 14.5h5.8M18.4 14.5h5.8M16 18.4v5.4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
