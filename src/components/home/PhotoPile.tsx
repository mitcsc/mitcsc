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
/** A released polaroid slows down by a factor of e every this many ms, like a flicked scroll view. */
const GLIDE_DECAY_MS = 325;
/** The share of its speed a polaroid keeps when it bounces off an edge. */
const BOUNCE = 0.45;
/** Speeds in px/ms. A glide starts above MIN_FLING and stops below STOP. */
const MAX_SPEED = 4;
const MIN_FLING = 0.1;
const STOP = 0.01;
/** The release speed comes from the pointer moves in this last stretch of the drag, ms. */
const VELOCITY_WINDOW_MS = 100;

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

interface Sample { t: number; x: number; y: number }

// The pointer speed at release, in px/ms. A pointer that stopped before letting go has none.
function releaseVelocity(samples: Sample[], now: number) {
  const recent = samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const first = recent[0];
  const last = recent.at(-1)!;
  const dt = Math.max(last.t - first.t, 16);
  const vx = (last.x - first.x) / dt;
  const vy = (last.y - first.y) / dt;
  const speed = Math.hypot(vx, vy);
  const cap = speed > MAX_SPEED ? MAX_SPEED / speed : 1;
  return { vx: vx * cap, vy: vy * cap };
}

// Move along one axis, bouncing off either end.
function step(position: number, velocity: number, dt: number, min: number, max: number) {
  const next = position + velocity * dt;
  if (next < min) return [min, -velocity * BOUNCE];
  if (next > max) return [max, -velocity * BOUNCE];
  return [next, velocity];
}

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
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    // The animation frame of each polaroid still sliding after a release.
    const glides = new Map<HTMLElement, number>();

    function stopGlide(polaroid: HTMLElement) {
      cancelAnimationFrame(glides.get(polaroid)!);
      glides.delete(polaroid);
    }

    // After a fling, the polaroid keeps sliding, slows down, and bounces off the edges of the pile.
    function glide(polaroid: HTMLElement, vx: number, vy: number, bounds: ReturnType<typeof limits>) {
      let { dx, dy } = offset(polaroid);
      let last = performance.now();
      const frame = (now: number) => {
        const dt = Math.min(now - last, 50);
        last = now;
        [dx, vx] = step(dx, vx, dt, bounds.minX, bounds.maxX);
        [dy, vy] = step(dy, vy, dt, bounds.minY, bounds.maxY);
        const decay = Math.exp(-dt / GLIDE_DECAY_MS);
        vx *= decay;
        vy *= decay;
        setOffset(polaroid, dx, dy);
        if (Math.hypot(vx, vy) < STOP) glides.delete(polaroid);
        else glides.set(polaroid, requestAnimationFrame(frame));
      };
      glides.set(polaroid, requestAnimationFrame(frame));
    }

    // Pull every polaroid inside the pile, for example after the window shrinks.
    function fitAll() {
      glides.forEach((_, polaroid) => stopGlide(polaroid));
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

    // A photo that fails to load, for example one just deleted from Drive, leaves the pile instead of showing a broken image.
    // Its cell stays, so the other photos do not move.
    function hideBroken(img: HTMLImageElement) {
      const polaroid = img.closest<HTMLElement>(".hero-polaroid");
      if (polaroid) polaroid.style.visibility = "hidden";
    }
    // A loaded photo fades in over its placeholder. The page's inline script marks photos too, but it does not run after a client-side navigation.
    const markLoaded = (img: HTMLImageElement) => img.setAttribute("data-loaded", "");
    for (const img of root.querySelectorAll("img")) {
      if (img.complete && img.naturalWidth) markLoaded(img);
      else if (img.complete) hideBroken(img);
    }
    const onLoad = (event: Event) => { if (event.target instanceof HTMLImageElement) markLoaded(event.target); };
    const onError = (event: Event) => { if (event.target instanceof HTMLImageElement) hideBroken(event.target); };
    root.addEventListener("load", onLoad, true);
    root.addEventListener("error", onError, true);
    resize.observe(root);

    let drag: {
      polaroid: HTMLElement; pointerId: number; touch: boolean; active: boolean; holdTimer?: number;
      startX: number; startY: number; dx: number; dy: number; bounds: ReturnType<typeof limits>; samples: Sample[];
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
      // A tap catches a sliding polaroid.
      stopGlide(polaroid);
      const { dx, dy } = offset(polaroid);
      drag = {
        polaroid, pointerId: event.pointerId, touch: event.pointerType === "touch", active: false,
        startX: event.clientX, startY: event.clientY, dx, dy, bounds: limits(measure(polaroid), root!.clientWidth, root!.clientHeight), samples: [],
      };
      if (drag.touch) drag.holdTimer = window.setTimeout(start, TOUCH_HOLD_MS);
    }

    function onMove(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const moveX = event.clientX - drag.startX;
      const moveY = event.clientY - drag.startY;
      if (!drag.active) {
        const distance = Math.hypot(moveX, moveY);
        if (drag.touch && distance > TOUCH_SLOP) return end(event);
        if (!drag.touch && distance > MOUSE_SLOP) start();
        if (!drag.active) return;
      }
      const { minX, maxX, minY, maxY } = drag.bounds;
      setOffset(drag.polaroid, clamp(drag.dx + moveX, minX, maxX), clamp(drag.dy + moveY, minY, maxY));
      drag.samples.push({ t: event.timeStamp, x: event.clientX, y: event.clientY });
      if (drag.samples.length > 20) drag.samples.shift();
    }

    function end(event?: PointerEvent) {
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      window.clearTimeout(drag.holdTimer);
      drag.polaroid.classList.remove("is-dragging");
      if (drag.active && event?.type === "pointerup" && !calm.matches) {
        const { vx, vy } = releaseVelocity(drag.samples, event.timeStamp);
        if (Math.hypot(vx, vy) > MIN_FLING) glide(drag.polaroid, vx, vy, drag.bounds);
      }
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
      root.removeEventListener("load", onLoad, true);
      root.removeEventListener("error", onError, true);
      glides.forEach((_, polaroid) => stopGlide(polaroid));
      root.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      root.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  return <ul ref={pile} className={className}>{children}</ul>;
}
