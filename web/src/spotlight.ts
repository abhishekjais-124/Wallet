import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "./ui.tsx";

/**
 * The spotlight stack: every tile is a strip, and the one on the spotline (the scroller's top padding) is open.
 * Nothing switches state on a timer: each frame, the scroll position is turned into a fractional index p, and every
 * tile after the line has its contents pushed down by `grow * clamp(i - p, 0, 1)` (grow: how much taller the open
 * tile is). So as you scroll, the next card slides open
 * under your finger while the current one folds away, 1:1. CSS scroll-snap settles on a card when the scroll ends,
 * with the platform's own momentum. Returns which tile is open and a way to bring another one in.
 */
export function useSpotlight(ref: React.RefObject<HTMLElement | null>, key: unknown) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useRef<string | null>(null);

  // a custom property would come back as an unresolved calc(): read the resolved padding instead
  const spotTop = (el: HTMLElement) => parseFloat(getComputedStyle(el).paddingTop) || 0;
  const bring = useCallback((id: string) => {
    const el = ref.current;
    const tile = el?.querySelector<HTMLElement>(`[data-tile="${CSS.escape(id)}"]`);
    if (el && tile) el.scrollTo({ top: tile.offsetTop - spotTop(el), behavior: "smooth" });
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    // layout is measured once per change of the list or the viewport, never inside the scroll frame
    let tiles: HTMLElement[] = [];
    let tops: number[] = [];
    let grows: number[] = [];
    let line0 = 0;

    const measure = () => {
      tiles = [...el.querySelectorAll<HTMLElement>("[data-tile]")];
      tops = tiles.map((t) => t.offsetTop);
      line0 = spotTop(el);
      // how much taller each tile is when open (cards and IDs differ)
      grows = tiles.map((t) => Math.max(0, ((t.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0) - t.offsetHeight));
    };

    const frame = () => {
      raf = 0;
      if (!tiles.length) return;
      const line = el.scrollTop + line0;
      // fractional index: k + how far the line is between tile k and k+1
      let k = 0;
      while (k < tops.length - 1 && tops[k + 1]! <= line) k++;
      const next = tops[k + 1];
      const f = next === undefined ? 0 : Math.min(1, Math.max(0, (line - tops[k]!) / (next - tops[k]!)));
      const p = k + f;
      // the open space blends from tile k's height to tile k+1's as the spotlight moves between them
      const grow = grows[k]! + ((grows[k + 1] ?? grows[k]!) - grows[k]!) * f;
      const shift = (i: number) => grow * Math.min(1, Math.max(0, i - p));
      // the tile itself stays put (it is the snap point); its contents move, through --shift (styles.css)
      tiles.forEach((t, i) => {
        t.style.setProperty("--shift", `${shift(i)}px`);
        // how far a tile above the line has folded away (0 open, 1 a strip): it recedes and dims with it
        t.style.setProperty("--fold", `${Math.min(1, Math.max(0, p - i))}`);
        // how far a tile at or after the line has opened (1 open, 0 a strip): the last tile has nothing covering it
        t.style.setProperty("--open", `${1 - Math.min(1, Math.max(0, i - p))}`);
      });

      const best = tiles[Math.round(p)]!;
      const id = best.dataset.tile ?? null;
      if (id !== active.current) {
        tiles.forEach((t) => t.classList.toggle("active", t === best));
        if (active.current !== null) haptic("selection");
        active.current = id;
        setActiveId(id);
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const onResize = () => { measure(); onScroll(); };

    measure();
    frame();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    // fonts, images and the IDs section arrive after the first paint: measure again when sizes change
    const ro = new ResizeObserver(onResize);
    for (const child of el.children) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [ref, key]);

  return { activeId, bring };
}
