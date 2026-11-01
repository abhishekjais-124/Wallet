import React from "react";
import { DOC_LABEL, DOC_SUBTITLE, formatDocNumber, maskDocNumber, type IdDoc } from "@shared/doc.ts";
import { Icon } from "../ui.tsx";

export type FaceDoc = Pick<IdDoc, "type" | "name" | "number" | "dob" | "validTill" | "files">;

/**
 * An ID document drawn like a wallet pass: a thin colour band, the document's mark and name, then the holder's
 * name, the number and dates, with the first photo as a small thumbnail. Our own drawing, not the government
 * designs; Aadhaar on cream with the tricolour, PAN in blue, the licence in teal. Sized by its container.
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
  return (
    <Tag className={`idface is-${doc.type}`} onClick={onClick} aria-label={label} type={onClick ? "button" : undefined}>
      <div className="id-inner">
        <div className="id-band" />
        <DocMark type={doc.type} className="id-watermark" />
        <div className="id-head">
          <DocMark type={doc.type} />
          <div className="id-title">
            <strong>{DOC_LABEL[doc.type]}</strong>
            <small>{DOC_SUBTITLE[doc.type]}</small>
          </div>
          {doc.files.length > 0 && (
            <span className="id-files" aria-label={`${photos} photos, ${pdfs} PDFs`}>
              {photos > 0 && <span><Icon name="image" size={12} />{photos}</span>}
              {pdfs > 0 && <span><Icon name="file" size={12} />{pdfs}</span>}
            </span>
          )}
        </div>
        <div className="id-body">
          <div className="id-fields">
            <span className="id-name">{doc.name || "Your name"}</span>
            <span className="id-number">{number}</span>
            <span className="id-meta">
              {doc.dob && <span><small>Born</small>{doc.dob}</span>}
              {doc.type === "dl" && doc.validTill && <span><small>Valid till</small>{doc.validTill}</span>}
            </span>
          </div>
          {photo && <span className="id-thumb" aria-hidden="true"><img src={photo.data} alt="" draggable={false} /></span>}
        </div>
      </div>
    </Tag>
  );
});

/** Small marks drawn for this app: a sunburst for Aadhaar, a PAN monogram, a steering wheel for the licence. */
export function DocMark({ type, className = "id-mark" }: { type: IdDoc["type"]; className?: string }) {
  if (type === "aadhaar") {
    return (
      <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
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
      <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="8" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeOpacity="0.45" />
        <text x="16" y="20.5" textAnchor="middle" fontSize="11" fontWeight="800" fill="currentColor" fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" letterSpacing="0.4">PAN</text>
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="15" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeOpacity="0.5" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="16" cy="16" r="2.4" fill="currentColor" />
      <path d="M7.8 14.5h5.8M18.4 14.5h5.8M16 18.4v5.4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
