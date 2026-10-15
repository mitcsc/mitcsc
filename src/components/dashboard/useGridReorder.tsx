"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

// A card being dragged: where it started and where it would land, the pointer's travel,
// and where every card sat on screen when the drag began.
type Drag = { from: number; to: number; dx: number; dy: number; startX: number; startY: number; rects: DOMRect[]; active: boolean; pointerId: number };

const MOVABLE = ":scope > [data-reorder]";
// How far the pointer travels before a press becomes a drag. A shorter press is a click.
const DRAG_THRESHOLD = 6;

// Drag-to-reorder for a grid whose cards carry itemProps(i).
// A mouse drags a card from anywhere on it. Touch drags only from the card's handle (handleProps), so the page still scrolls.
// The dragged card follows the pointer, and the others slide into the places they would take.
// On a drop, and on an arrow-key move, the moved cards glide from where they were into their new places.
// onMove(from, to) must reorder the list in the same event, so the new order shows in the next render.
export function useGridReorder<T extends HTMLElement>({ count, onMove, disabled = false }: { count: number; onMove: (from: number, to: number) => void; disabled?: boolean }) {
  const listRef = useRef<T>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // Where each card was on screen just before a move.
  const before = useRef<Map<HTMLElement, DOMRect> | null>(null);
  // The click that ends a drag must not open the card.
  const swallowClick = useRef(false);

  const cards = () => (listRef.current ? [...listRef.current.querySelectorAll<HTMLElement>(MOVABLE)] : []);

  function prepareMove() {
    before.current = new Map(cards().map((card) => [card, card.getBoundingClientRect()]));
    listRef.current?.setAttribute("data-settling", "");
  }

  // After a move, each card that changed place starts where it was and glides into its slot.
  useLayoutEffect(() => {
    const list = listRef.current;
    const rects = before.current;
    if (!rects || !list) return;
    before.current = null;
    const moved: HTMLElement[] = [];
    for (const card of cards()) {
      const was = rects.get(card);
      if (!was) continue;
      const now = card.getBoundingClientRect();
      const x = was.left - now.left;
      const y = was.top - now.top;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
      card.style.transform = `translate(${x}px, ${y}px)`;
      card.setAttribute("data-lifted", "");
      moved.push(card);
    }
    list.getBoundingClientRect();
    requestAnimationFrame(() => {
      list.removeAttribute("data-settling");
      for (const card of moved) {
        card.style.transform = "";
        const done = () => card.removeAttribute("data-lifted");
        card.addEventListener("transitionend", done, { once: true });
        window.setTimeout(done, 400);
      }
    });
  });

  function press(event: PointerEvent<HTMLElement>, from: number, fromHandle: boolean) {
    if (disabled || event.button !== 0 || dragRef.current) return;
    if (event.pointerType === "touch" && !fromHandle) return;
    const all = cards();
    if (!all[from]) return;
    dragRef.current = { from, to: from, dx: 0, dy: 0, startX: event.clientX, startY: event.clientY, rects: all.map((c) => c.getBoundingClientRect()), active: false, pointerId: event.pointerId };
    if (fromHandle) event.preventDefault();
  }

  function move(event: PointerEvent<HTMLElement>) {
    const d = dragRef.current;
    if (!d || event.pointerId !== d.pointerId) return;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    if (!d.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    // The card lands in the slot whose middle is nearest the dragged card's middle.
    const start = d.rects[d.from];
    const x = start.left + start.width / 2 + dx;
    const y = start.top + start.height / 2 + dy;
    let to = d.from;
    let best = Infinity;
    d.rects.forEach((r, i) => {
      const distance = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
      if (distance < best) { best = distance; to = i; }
    });
    dragRef.current = { ...d, dx, dy, to };
    setDrag(dragRef.current);
  }

  function end(commit: boolean) {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (!d.active) return;
    swallowClick.current = true;
    window.setTimeout(() => (swallowClick.current = false), 0);
    prepareMove();
    setDrag(null);
    if (commit && d.to !== d.from) onMove(d.from, d.to);
  }

  // Arrow keys move the focused card by one place, or by one row up or down.
  function key(event: KeyboardEvent<HTMLElement>, from: number) {
    const rects = cards().map((c) => c.getBoundingClientRect());
    const columns = Math.max(1, rects.filter((r) => Math.abs(r.top - rects[0].top) < 2).length);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
    if (disabled || dragRef.current || step === undefined) return;
    const to = Math.max(0, Math.min(count - 1, from + step));
    event.preventDefault();
    if (to === from) return;
    prepareMove();
    onMove(from, to);
  }

  // Where card i sits while another card is dragged: its own slot, or the one next to it that it slides into.
  function offset(i: number) {
    if (!drag) return null;
    if (i === drag.from) return { x: drag.dx, y: drag.dy };
    let slot = i;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) slot = i - 1;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) slot = i + 1;
    if (slot === i) return null;
    return { x: drag.rects[slot].left - drag.rects[i].left, y: drag.rects[slot].top - drag.rects[i].top };
  }

  return {
    listRef,
    sorting: drag !== null,
    // Spread onto each card. className is "is-dragging" for the card in hand.
    itemProps(i: number) {
      const at = offset(i);
      return {
        "data-reorder": "",
        className: drag?.from === i ? "is-dragging" : "",
        style: (at ? { transform: `translate(${at.x}px, ${at.y}px)` } : undefined) as CSSProperties | undefined,
        onPointerDown: (e: PointerEvent<HTMLElement>) => press(e, i, false),
        onPointerMove: move,
        onPointerUp: () => end(true),
        onPointerCancel: () => end(false),
        onClickCapture: (e: MouseEvent<HTMLElement>) => { if (swallowClick.current) { e.preventDefault(); e.stopPropagation(); } },
      };
    },
    // Spread onto the card's drag handle, which works for touch and the keyboard too.
    handleProps(i: number) {
      return {
        disabled,
        "data-tip": disabled || drag ? undefined : "Drag to reorder",
        onPointerDown: (e: PointerEvent<HTMLElement>) => { e.stopPropagation(); press(e, i, true); },
        onKeyDown: (e: KeyboardEvent<HTMLElement>) => key(e, i),
      };
    },
  };
}
