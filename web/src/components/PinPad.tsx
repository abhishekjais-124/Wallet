import React, { useEffect, useRef, useState } from "react";
import { haptic, Icon } from "../ui.tsx";

export const PIN_LENGTH = 9;

/**
 * Passcode screen: nine dots and a phone-style number pad (hardware keys work too).
 * Calls onComplete when the ninth digit lands: null keeps the dots, "" clears them, an error message shakes and clears.
 */
export function PinPad({ onComplete, busy }: { onComplete: (pin: string) => Promise<string | null>; busy: boolean }) {
  const [pin, setPinState] = useState("");
  const [shake, setShake] = useState(0);
  // the ref holds the digits typed so far, so taps faster than a re-render are not lost
  const pinRef = useRef("");
  const setPin = (p: string) => {
    pinRef.current = p;
    setPinState(p);
  };

  const press = (d: string) => {
    if (busy || pinRef.current.length >= PIN_LENGTH) return;
    haptic("selection");
    const next = pinRef.current + d;
    setPin(next);
    if (next.length < PIN_LENGTH) return;
    onComplete(next).then((err) => {
      if (err === null) return;
      if (err) { haptic("error"); setShake((n) => n + 1); } // "" means "go on to the next step": clear without shaking
      setPin("");
    });
  };
  const back = () => !busy && setPin(pinRef.current.slice(0, -1));
  // a key counts on touch-down, like the iPhone passcode pad, so quick taps are never merged or dropped;
  // a click with no pointer (keyboard, switch control) still works
  const key = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); fn(); },
    onClick: (e: React.MouseEvent) => { if (e.detail === 0) fn(); },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="pinpad">
      <div className={`pin-dots${busy ? " busy" : ""}`} key={shake} data-shake={shake > 0 || undefined} role="status" aria-label={`${pin.length} of ${PIN_LENGTH} digits`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => <span key={i} className={i < pin.length ? "on" : ""} />)}
      </div>
      <div className="pin-keys">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" className="pin-key" {...key(() => press(d))} disabled={busy}>{d}</button>
        ))}
        <span />
        <button type="button" className="pin-key" {...key(() => press("0"))} disabled={busy}>0</button>
        <button type="button" className="pin-key ghost" {...key(back)} disabled={busy || !pin} aria-label="Delete digit"><Icon name="back" size={22} /></button>
      </div>
    </div>
  );
}
