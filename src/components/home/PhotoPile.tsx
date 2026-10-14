"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Polaroids grow by this much on hover (see `.hero-polaroid:hover` in globals.css), so they stay inside even then. */
const HOVER_SCALE = 1.06;
/** Gap kept between a polaroid and the edge of the pile, px. */
const EDGE = 4;
/** A mouse drag starts after this many px, so a plain click stays a click. */
const MOUSE_SLOP = 3;
/** A finger must rest this long before a drag starts. A quicker swipe scrolls the page. */
const TOUCH_HOLD_MS = 180;
/** A finger that moves this far during the hold is scrolling, not dragging. */
const TOUCH_SLOP = 8;

interface Box {
  /** Centre without the drag offset, in pile coordinates. */
  cx: number;
  cy: number;
  /** Half the width and height of the tilted, scaled polaroid. */
  hw: number;
  hh: number;
}

function offset(el: HTMLElement) {
  return { dx: parseFloat(el.style.getPropertyValue("--dx")) || 0, dy: parseFloat(el.style.getPropertyValue("--dy")) || 0 };
}

function setOffset(el: HTMLElement, dx: number, dy: number) {
  el.style.setProperty("--dx", `${dx.toFixed(1)}px`);
  el.style.setProperty("--dy", `${dy.toFixed(1)}px`);
}

// Where the polaroid sits from layout alone, so the entrance animation does not skew it.
function measure(polaroid: HTMLElement): Box {
  const slot = polaroid.offsetParent as HTMLElement;
  const style = getComputedStyle(polaroid);
  const tilt = (parseFloat(style.getPropertyValue("--tilt")) * Math.PI) / 180;
  const scale = (parseFloat(style.getPropertyValue("--s")) || 1) * HOVER_SCALE;
  const w = polaroid.offsetWidth;
  const h = polaroid.offsetHeight;
  const cos = Math.abs(Math.cos(tilt));
  const sin = Math.abs(Math.sin(tilt));
  return {
    cx: slot.offsetLeft + polaroid.offsetLeft + w / 2,
    cy: slot.offsetTop + polaroid.offsetTop + h / 2,
    hw: (scale * (w * cos + h * sin)) / 2,
    hh: (scale * (w * sin + h * cos)) / 2,
  };
}

// The drag offsets that keep a polaroid fully inside the pile.
function limits(box: Box, width: number, height: number) {
  const fit = (min: number, max: number) => (min > max ? [(min + max) / 2, (min + max) / 2] : [min, max]);
  const [minX, maxX] = fit(EDGE + box.hw - box.cx, width - EDGE - box.hw - box.cx);
  const [minY, maxY] = fit(EDGE + box.hh - box.cy, height - EDGE - box.hh - box.cy);
  return { minX, maxX, minY, maxY };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The hero's photo pile. Every polaroid stays fully inside it, and visitors can drag them around.
 * The last one dragged lands on top.
 */
export default function PhotoPile({ className, children }: { className: string; children: ReactNode }) {
  const pile = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const root = pile.current;
    if (!root) return;
    const polaroids = () => [...root.querySelectorAll<HTMLElement>(".hero-polaroid")].filter((p) => p.offsetParent);
    let top = 30;

    // Pull every polaroid inside the pile, for example after the window shrinks.
    function fitAll() {
      const { clientWidth: width, clientHeight: height } = root!;
      for (const polaroid of polaroids()) {
        const box = measure(polaroid);
        const { minX, maxX, minY, maxY } = limits(box, width, height);
        const { dx, dy } = offset(polaroid);
        setOffset(polaroid, clamp(dx, minX, maxX), clamp(dy, minY, maxY));
      }
    }
    fitAll();
    const resize = new ResizeObserver(fitAll);
    resize.observe(root);

    let drag: {
      polaroid: HTMLElement; pointerId: number; touch: boolean; active: boolean; holdTimer?: number;
      startX: number; startY: number; dx: number; dy: number; bounds: ReturnType<typeof limits>;
    } | null = null;

    function start() {
      if (!drag) return;
      drag.active = true;
      drag.polaroid.style.zIndex = String(++top);
      drag.polaroid.classList.add("is-dragging");
      if (!drag.touch) drag.polaroid.setPointerCapture(drag.pointerId);
    }

    function onDown(event: PointerEvent) {
      const polaroid = (event.target as HTMLElement).closest<HTMLElement>(".hero-polaroid");
      if (!polaroid || !root!.contains(polaroid) || (event.pointerType === "mouse" && event.button !== 0)) return;
      const { dx, dy } = offset(polaroid);
      drag = {
        polaroid, pointerId: event.pointerId, touch: event.pointerType === "touch", active: false,
        startX: event.clientX, startY: event.clientY, dx, dy, bounds: limits(measure(polaroid), root!.clientWidth, root!.clientHeight),
      };
      if (drag.touch) drag.holdTimer = window.setTimeout(start, TOUCH_HOLD_MS);
    }

    function onMove(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const moveX = event.clientX - drag.startX;
      const moveY = event.clientY - drag.startY;
      if (!drag.active) {
        const distance = Math.hypot(moveX, moveY);
        if (drag.touch && distance > TOUCH_SLOP) return end();
        if (!drag.touch && distance > MOUSE_SLOP) start();
        if (!drag.active) return;
      }
      const { minX, maxX, minY, maxY } = drag.bounds;
      setOffset(drag.polaroid, clamp(drag.dx + moveX, minX, maxX), clamp(drag.dy + moveY, minY, maxY));
    }

    function end() {
      if (!drag) return;
      window.clearTimeout(drag.holdTimer);
      drag.polaroid.classList.remove("is-dragging");
      drag = null;
    }

    // Once a finger drag starts, the page must not scroll under it.
    function onTouchMove(event: TouchEvent) {
      if (drag?.active) event.preventDefault();
    }

    root.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      resize.disconnect();
      root.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      root.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  return <ul ref={pile} className={className}>{children}</ul>;
}
