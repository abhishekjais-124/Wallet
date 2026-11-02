import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";

const PATHS = {
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35",
  plus: "M12 5v14M5 12h14",
  chevron: "m9 6 6 6-6 6",
  more: "M5 13.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4ZM12 13.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4ZM19 13.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z",
  clock: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  cloud: "M7 18h10.5a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.3 9.6 4.2 4.2 0 0 0 7 18Z",
  lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  eye: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Zm11 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  eyeOff: "M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 4M6.6 6.6A18 18 0 0 0 1 12s4 7 11 7a10.8 10.8 0 0 0 5.4-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2",
  star: "M11.1 3.6a1 1 0 0 1 1.8 0l2.2 4.6 5 .7a1 1 0 0 1 .6 1.7l-3.7 3.6.9 5a1 1 0 0 1-1.5 1.1L12 18l-4.5 2.4A1 1 0 0 1 6 19.3l.9-5-3.7-3.6a1 1 0 0 1 .6-1.7l5-.7z",
  trash: "M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6 7l.8 11.2A2 2 0 0 0 8.8 20h6.4a2 2 0 0 0 2-1.8L18 7M10 11v5M14 11v5",
  edit: "M16.5 3.8a2.1 2.1 0 0 1 3 3L8.3 18 4 19.5 5.5 15.2zM14.5 5.8l3 3",
  x: "M18 6 6 18M6 6l12 12",
  check: "M20 6 9 17l-5-5",
  image: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5a1.5 1.5 0 1 0 0-.01",
  download: "M12 3v12m0 0 5-5m-5 5-5-5M4 21h16",
  upload: "M12 21V9m0 0 5 5m-5-5-5 5M4 3h16",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
  flip: "M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16m0 5v-5h5",
  key: "M15 7a4 4 0 1 1-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0 1 15 7Z",
  back: "M21 5H9l-7 7 7 7h12zM17 9l-6 6M11 9l6 6",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4",
  idcard: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.5 16.5c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4M14 9.5h4M14 13h4",
  card: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M7 15h3",
  share: "M12 14V3.5M8 7.2l4-4 4 4M8 10H7a2 2 0 0 0-2 2v6.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V12a2 2 0 0 0-2-2h-1",
  faceid: "M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 9.5v1.5M15 9.5v1.5M12 9.5V13h-1M9.3 15.3a3.8 3.8 0 0 0 5.4 0",
  touchid: "M12 3.5a8.5 8.5 0 0 1 8.5 8.5M12 3.5A8.5 8.5 0 0 0 3.5 12M6.5 12a5.5 5.5 0 0 1 11 0v2M9.5 12a2.5 2.5 0 0 1 5 0c0 3-1 6-2.5 7.5M12 15v2.5M6.5 15c.3 2.2 1 4 2 5.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** A tap on the Taptic Engine when inside the Wallet iPhone app; nothing elsewhere. */
export type Haptic = "light" | "medium" | "selection" | "success" | "error";
const taptic = (window as { webkit?: { messageHandlers?: { walletHaptic?: { postMessage: (m: { op: string }) => Promise<unknown> } } } }).webkit?.messageHandlers?.walletHaptic;
export function haptic(kind: Haptic = "light"): void {
  taptic?.postMessage({ op: kind }).catch(() => {});
}

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
type VTDocument = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

/**
 * The browser calls a view transition's callback on its next frame. A page that is not being drawn (backgrounded,
 * a hidden pane) has no next frame, so the update is applied from a timer instead and the callback becomes a no-op.
 */
function viewTransition(update: () => void, after: () => void): void {
  const d = document as VTDocument;
  let done = false;
  const run = () => { if (!done) { done = true; update(); } };
  const fallback = setTimeout(run, 350);
  d.startViewTransition!(() => { clearTimeout(fallback); flushSync(run); }).finished.finally(after);
}

/**
 * Runs a state change as a View Transition (Safari 18+, Chrome) so the screens cross-fade or, with `kind` set on
 * <html data-vt>, play the animation styles.css defines for it. Without the API the change just happens.
 */
export function transition(update: () => void, kind?: string): void {
  const d = document as VTDocument;
  if (!d.startViewTransition || reduceMotion() || document.hidden) return update();
  if (kind) document.documentElement.dataset.vt = kind;
  viewTransition(update, () => {
    if (document.documentElement.dataset.vt === kind) delete document.documentElement.dataset.vt;
  });
}

/**
 * Sheets and focused views render into #overlays, a layer beside the app: drawn inside the card scroller they would
 * be clipped by it.
 */
const overlay = (node: React.ReactNode) => createPortal(node, document.getElementById("overlays") ?? document.body);

// open sheets and focused views; the page under them scrolls again only when the last one closes
let overlays = 0;
function lockPage(): () => void {
  if (overlays++ === 0) document.body.classList.add("sheet-open");
  return () => { if (--overlays === 0) document.body.classList.remove("sheet-open"); };
}

/** Bottom sheet on phones, centred dialog on wide screens. Escape and the backdrop close it. */
export function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // closing is a view transition, so the sheet slides away instead of vanishing
  const close = useCallback(() => transition(onClose, "sheet"), [onClose]);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const unlock = lockPage();
    return () => {
      window.removeEventListener("keydown", onKey);
      unlock();
      prev?.focus?.();
    };
  }, [close]);
  return overlay(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`sheet${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="btn icon ghost" onClick={close} aria-label="Close"><Icon name="x" /></button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? "on" : ""} onClick={() => { if (o.value !== value) { haptic("selection"); onChange(o.value); } }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Apple Wallet's tapped-card view: the item fills the screen with its details below, and the others wait in a pile
 * at the bottom; tapping the pile or Done goes back to the stack.
 */
export function Focus({ title, onClose, pile, children }: { title: string; onClose: () => void; pile?: React.ReactNode; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const unlock = lockPage();
    return () => {
      window.removeEventListener("keydown", onKey);
      unlock();
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return overlay(
    <div className="focus" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
      <header className="focus-head">
        <button type="button" className="pill-btn" onClick={() => { haptic(); onClose(); }}>Done</button>
      </header>
      <div className="focus-body">{children}</div>
      {pile && <button type="button" className="pile" onClick={() => { haptic(); onClose(); }} aria-label="Back to all">{pile}</button>}
    </div>
  );
}

/**
 * Moves a stack tile into the focused view and back as a View Transition (Safari 18+, Chrome): the tapped card glides
 * to the top instead of a sheet sliding up. The tile and the focused card share one transition name, set on the tile
 * only while it is the visible one. Without the API (or with reduced motion) the view just switches.
 */
export function glide(tileId: string, update: () => void, opening: boolean): void {
  const d = document as VTDocument;
  if (!d.startViewTransition || reduceMotion()) return update();
  const tile = () => document.querySelector<HTMLElement>(`[data-tile="${CSS.escape(tileId)}"]`);
  const name = (on: boolean) => tile()?.style.setProperty("view-transition-name", on ? "focus-card" : "none");
  if (opening) name(true);
  document.documentElement.dataset.vt = opening ? "open" : "close";
  viewTransition(() => { name(!opening); update(); }, () => { name(false); delete document.documentElement.dataset.vt; });
}

/** A round header button that opens a short list of actions, like the + and ••• buttons in Apple Wallet. */
export function Menu({ label, icon, items }: { label: string; icon: IconName; items: { label: string; icon: IconName; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="round-btn" aria-label={label} aria-expanded={open} aria-haspopup="menu" onClick={() => { haptic(); setOpen(!open); }}>
        <Icon name={icon} size={20} />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" onClick={() => { haptic("selection"); setOpen(false); it.onClick(); }}>
              <span>{it.label}</span><Icon name={it.icon} size={18} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- toast + clipboard ----

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(null);
  const show = useCallback((text: string) => setMsg({ text, id: Date.now() }), []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2200);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-wrap" aria-live="polite">{msg && <div className="toast" key={msg.id}><Icon name="check" size={16} />{msg.text}</div>}</div>
    </ToastCtx.Provider>
  );
}

const CLEAR_AFTER_MS = 30_000;
let lastSecret = 0;

/** Copies text; secrets are overwritten in the clipboard after 30 s (best effort: browsers allow it only while focused). */
export function useCopy() {
  const toast = useToast();
  return useCallback(async (text: string, label: string, secret = false) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast("Copy blocked by the browser");
      return;
    }
    haptic("success");
    if (!secret) return toast(`${label} copied`);
    const mine = ++lastSecret;
    toast(`${label} copied · clears in 30 s`);
    setTimeout(() => {
      if (mine === lastSecret) navigator.clipboard.writeText("").catch(() => {});
    }, CLEAR_AFTER_MS);
  }, [toast]);
}

/** A value that flips back to false on its own, used for revealed secrets. */
export function useAutoHide(ms = 20_000): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return [on, setOn];
}
