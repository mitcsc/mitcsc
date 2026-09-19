"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Lightweight portal tooltip: fast hover, immediate focus, no layout changes. */
export function useTooltip(text: string) {
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<{left: number; top: number; arrow: number; above: boolean} | null>(null);
  const close = () => { if (timer.current) clearTimeout(timer.current); setAnchor(null); setPosition(null); };
  const open = (element: HTMLElement, delay = 100) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAnchor(element), delay);
  };
  useLayoutEffect(() => {
    if (!anchor || !bubble.current) return;
    const target = anchor.getBoundingClientRect();
    const box = bubble.current.getBoundingClientRect();
    const center = target.left + target.width / 2;
    const left = Math.max(12, Math.min(center - box.width / 2, window.innerWidth - box.width - 12));
    const above = target.bottom + box.height + 10 > window.innerHeight - 12 && target.top > box.height + 10;
    setPosition({left, top: above ? target.top - box.height - 8 : target.bottom + 8,
      arrow: Math.max(8, Math.min(center - left, box.width - 8)), above});
  }, [anchor, text]);
  useEffect(() => {
    const dismiss = () => { if (timer.current) clearTimeout(timer.current); setAnchor(null); setPosition(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", key);
    return () => { dismiss(); window.removeEventListener("scroll", dismiss, true); window.removeEventListener("resize", dismiss); window.removeEventListener("keydown", key); };
  }, []);
  return {
    triggerProps: {
      "aria-describedby": position ? id : undefined,
      onPointerEnter: (event: React.PointerEvent<HTMLElement>) => { if (event.pointerType !== "touch") open(event.currentTarget); },
      onPointerLeave: close,
      onPointerDown: close,
      onFocus: (event: React.FocusEvent<HTMLElement>) => open(event.currentTarget, 0),
      onBlur: close,
    },
    tooltip: anchor ? createPortal(<div ref={bubble} id={id} role="tooltip" className="csc-tooltip" data-side={position?.above ? "top" : "bottom"} style={{left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden"}}>{text}<span className="csc-tooltip-arrow" style={{left: position?.arrow ?? 0}}/></div>, document.body) : null,
  };
}
