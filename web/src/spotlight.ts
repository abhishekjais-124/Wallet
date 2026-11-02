import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "./ui.tsx";

/**
 * The spotlight stack: every tile is a strip, and the one nearest the spotline (`--spot-top` into the scroller) is
 * open. The tiles after it slide down by the open card's extra height (a transform, so the layout never jumps),
 * and when the scroll comes to rest the open tile is pulled onto the spotline. Returns which tile is open and a
 * way to bring another one in.
 */
export function useSpotlight(ref: React.RefObject<HTMLElement | null>, key: unknown) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useRef<string | null>(null);

  // the spotline is the scroller's top padding (a custom property would come back as an unresolved calc())
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
    let idle = 0;

    const apply = (): HTMLElement | null => {
      raf = 0;
      const line = el.scrollTop + spotTop(el);
      const tiles = [...el.querySelectorAll<HTMLElement>("[data-tile]")];
      if (!tiles.length) return null;
      let best = tiles[0]!;
      for (const t of tiles) if (Math.abs(t.offsetTop - line) < Math.abs(best.offsetTop - line)) best = t;
      const face = best.firstElementChild as HTMLElement | null;
      el.style.setProperty("--grow", `${Math.max(0, (face?.offsetHeight ?? 0) - best.offsetHeight)}px`);
      // everything after the open tile, the IDs heading included, moves down to make room for it
      let after = false;
      for (const node of el.querySelectorAll<HTMLElement>("[data-tile], .stack-section h2")) {
        node.classList.toggle("active", node === best);
        node.classList.toggle("after", after);
        if (node === best) after = true;
      }
      const id = best.dataset.tile ?? null;
      if (id !== active.current) {
        if (active.current !== null) haptic("selection");
        active.current = id;
        setActiveId(id);
      }
      return best;
    };
    const snap = () => {
      const best = apply();
      if (!best) return;
      const top = best.offsetTop - spotTop(el);
      if (Math.abs(el.scrollTop - top) > 1) el.scrollTo({ top, behavior: "smooth" });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
      clearTimeout(idle);
      idle = window.setTimeout(snap, 160);
    };
    apply();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
      clearTimeout(idle);
    };
  }, [ref, key]);

  return { activeId, bring };
}
