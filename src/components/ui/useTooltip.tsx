"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// How long the pointer rests on a control before its tooltip shows. Keyboard focus shows it at once.
const HOVER_DELAY_MS = 300;

// The dashboard sets its font on a wrapper (`.m-font`), so the tooltip renders inside it to use the same font.
// In an open dialog it renders inside the dialog instead: a modal dialog covers everything outside it.
const fontRoot = (anchor: HTMLElement) => anchor.closest<HTMLElement>("dialog[open]") ?? anchor.closest<HTMLElement>(".m-font") ?? document.body;

// The tooltip box. It is fixed to the window, so a scrolling or clipping container never cuts it off.
// It sits below the anchor, or above when there is no room below, and stays 12px inside the window.
function TooltipBubble({ anchor, text, id }: { anchor: HTMLElement; text: string; id: string }) {
  const bubble = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; arrow: number; above: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!bubble.current) return;
    const target = anchor.getBoundingClientRect();
    const box = bubble.current.getBoundingClientRect();
    const center = target.left + target.width / 2;
    const left = Math.max(12, Math.min(center - box.width / 2, window.innerWidth - box.width - 12));
    const above = target.bottom + box.height + 10 > window.innerHeight - 12 && target.top > box.height + 10;
    setPosition({ left, top: above ? target.top - box.height - 8 : target.bottom + 8, arrow: Math.max(8, Math.min(center - left, box.width - 8)), above });
  }, [anchor, text]);
  return createPortal(
    <div ref={bubble} id={id} role="tooltip" className="csc-tooltip" data-side={position?.above ? "top" : "bottom"} style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}>
      {text}<span className="csc-tooltip-arrow" style={{ left: position?.arrow ?? 0 }} />
    </div>,
    fontRoot(anchor),
  );
}

// Closes a tooltip when the page scrolls or resizes, or on Escape.
function useDismiss(dismiss: () => void) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("scroll", dismiss, true); window.removeEventListener("resize", dismiss); window.removeEventListener("keydown", key); };
  }, [dismiss]);
}

/** A tooltip for one control: spread triggerProps on it and render tooltip. */
export function useTooltip(text: string) {
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [close] = useState(() => () => { if (timer.current) clearTimeout(timer.current); setAnchor(null); });
  const open = (element: HTMLElement, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAnchor(element), delay);
  };
  useDismiss(close);
  useEffect(() => close, [close]);
  return {
    triggerProps: {
      "aria-describedby": anchor ? id : undefined,
      onPointerEnter: (event: React.PointerEvent<HTMLElement>) => { if (event.pointerType !== "touch") open(event.currentTarget, HOVER_DELAY_MS); },
      onPointerLeave: close,
      onPointerDown: close,
      onFocus: (event: React.FocusEvent<HTMLElement>) => open(event.currentTarget, 0),
      onBlur: close,
    },
    tooltip: anchor ? <TooltipBubble anchor={anchor} text={text} id={id} /> : null,
  };
}

/**
 * Tooltips for every element with a data-tip attribute, such as <button data-tip="Add link">.
 * Mount once. It stays open on a click, so a hint like "Copy link" can change to "Copied".
 * It hides when the attribute goes away, and over an open menu (aria-expanded="true").
 */
export function HoverTips() {
  const id = useId();
  const [tip, setTip] = useState<{ anchor: HTMLElement; text: string } | null>(null);
  const state = useRef<{ anchor: HTMLElement | null; timer?: ReturnType<typeof setTimeout>; observer?: MutationObserver }>({ anchor: null });
  const [hide] = useState(() => () => {
    const s = state.current;
    clearTimeout(s.timer);
    s.observer?.disconnect();
    if (s.anchor?.getAttribute("aria-describedby") === id) s.anchor.removeAttribute("aria-describedby");
    state.current = { anchor: null };
    setTip(null);
  });
  useDismiss(hide);
  useEffect(() => {
    const blocked = (el: HTMLElement) => !el.isConnected || !el.dataset.tip || el.getAttribute("aria-expanded") === "true";
    const show = (el: HTMLElement, delay: number) => {
      if (state.current.anchor === el) return;
      hide();
      state.current.anchor = el;
      state.current.timer = setTimeout(() => {
        if (blocked(el)) return;
        el.setAttribute("aria-describedby", id);
        // The text can change while it shows, for example "Copy link" to "Copied".
        const observer = new MutationObserver(() => (blocked(el) ? hide() : setTip({ anchor: el, text: el.dataset.tip! })));
        observer.observe(el, { attributes: true, attributeFilter: ["data-tip", "aria-expanded"] });
        state.current.observer = observer;
        setTip({ anchor: el, text: el.dataset.tip! });
      }, delay);
    };
    const tipTarget = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null);
    const over = (event: PointerEvent) => {
      const el = tipTarget(event.target);
      if (el && event.pointerType !== "touch") show(el, HOVER_DELAY_MS);
    };
    const out = (event: PointerEvent) => {
      const anchor = state.current.anchor;
      if (anchor && !(event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget))) hide();
    };
    const focusIn = (event: FocusEvent) => {
      const el = tipTarget(event.target);
      if (el && el === event.target && el.matches(":focus-visible")) show(el, 0);
    };
    const focusOut = (event: FocusEvent) => { if (event.target === state.current.anchor) hide(); };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
    return () => {
      hide();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
    };
  }, [hide, id]);
  return tip ? <TooltipBubble anchor={tip.anchor} text={tip.text} id={id} /> : null;
}
