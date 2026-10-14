"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Icon } from "@/components/membership/icons";

// A row being dragged: where it started and where it would land, the pointer's travel,
// every row's middle on screen, and how far the other rows slide to make room.
type Drag = { from: number; to: number; dy: number; startY: number; min: number; max: number; mids: number[]; step: number };

const MOVABLE = ":scope > [data-reorder]";

// Drag-to-reorder for a list whose movable rows carry rowProps(i) and hold a DragHandle.
// The dragged row follows the pointer and the others slide aside to show where it lands.
// On a drop, and on an arrow-key move, the moved rows glide from where they were into their new places.
// onMove(from, to) must reorder the list in the same event, so the new order shows in the next render.
export function useReorder<T extends HTMLElement>({ count, onMove, disabled = false }: { count: number; onMove: (from: number, to: number) => void; disabled?: boolean }) {
  const listRef = useRef<T>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // Where each row was on screen just before a move.
  const before = useRef<Map<HTMLElement, number> | null>(null);

  const rows = () => (listRef.current ? [...listRef.current.querySelectorAll<HTMLElement>(MOVABLE)] : []);

  // Records where every row is, and stops the slide-aside transforms from animating back when they clear.
  function prepareMove() {
    before.current = new Map(rows().map((row) => [row, row.getBoundingClientRect().top]));
    listRef.current?.setAttribute("data-settling", "");
  }

  // After a move, each row that changed place starts where it was and glides into its slot.
  useLayoutEffect(() => {
    const list = listRef.current;
    const tops = before.current;
    if (!tops || !list) return;
    before.current = null;
    const moved: HTMLElement[] = [];
    for (const row of rows()) {
      const top = tops.get(row);
      const delta = top === undefined ? 0 : top - row.getBoundingClientRect().top;
      if (Math.abs(delta) < 0.5) continue;
      row.style.transform = `translateY(${delta}px)`;
      row.setAttribute("data-lifted", "");
      moved.push(row);
    }
    list.getBoundingClientRect();
    // Not cancelled by a later render, so a refresh right after the drop cannot leave rows stuck.
    requestAnimationFrame(() => {
      list.removeAttribute("data-settling");
      for (const row of moved) {
        row.style.transform = "";
        const done = () => row.removeAttribute("data-lifted");
        row.addEventListener("transitionend", done, { once: true });
        window.setTimeout(done, 400);
      }
    });
  });

  function start(event: PointerEvent<HTMLButtonElement>, from: number) {
    const all = rows();
    if (disabled || event.button !== 0 || !all[from]) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rects = all.map((row) => row.getBoundingClientRect());
    const gap = rects.length > 1 ? rects[1].top - rects[0].bottom : 0;
    const d: Drag = {
      from, to: from, dy: 0, startY: event.clientY,
      min: rects[0].top - rects[from].top, max: rects[rects.length - 1].bottom - rects[from].bottom,
      mids: rects.map((r) => r.top + r.height / 2), step: rects[from].height + gap,
    };
    dragRef.current = d;
    setDrag(d);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dy = Math.min(Math.max(event.clientY - d.startY, d.min), d.max);
    const center = d.mids[d.from] + dy;
    const to = d.mids.filter((mid, i) => i !== d.from && mid < center).length;
    dragRef.current = { ...d, dy, to };
    setDrag(dragRef.current);
  }

  function end(commit: boolean) {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    prepareMove();
    setDrag(null);
    if (commit && d.to !== d.from) onMove(d.from, d.to);
  }

  // Arrow keys move the focused row by one place.
  function key(event: KeyboardEvent<HTMLButtonElement>, from: number) {
    const to = event.key === "ArrowUp" ? from - 1 : event.key === "ArrowDown" ? from + 1 : -1;
    if (disabled || dragRef.current || to < 0 || to >= count) return;
    event.preventDefault();
    prepareMove();
    onMove(from, to);
  }

  // How far a row slides while another is dragged.
  function shift(i: number) {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.step;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return drag.step;
    return 0;
  }

  return {
    listRef,
    sorting: drag !== null,
    // Spread onto each movable row. className is "is-dragging" for the row in hand.
    rowProps(i: number) {
      const y = shift(i);
      return {
        "data-reorder": "",
        className: drag?.from === i ? "is-dragging" : "",
        style: (y ? { transform: `translateY(${y}px)` } : undefined) as CSSProperties | undefined,
      };
    },
    // Spread onto the row's DragHandle.
    handleProps(i: number) {
      return {
        disabled,
        // No hint while it cannot move, or while a row is being dragged.
        "data-tip": disabled || drag ? undefined : "Drag to reorder",
        onPointerDown: (e: PointerEvent<HTMLButtonElement>) => start(e, i),
        onPointerMove: move,
        onPointerUp: () => end(true),
        onPointerCancel: () => end(false),
        onLostPointerCapture: () => end(true),
        onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => key(e, i),
      };
    },
  };
}

type HandleProps = ReturnType<ReturnType<typeof useReorder>["handleProps"]>;

// The six-dot handle every reorderable list in the dashboard uses.
export function DragHandle({ label, ...props }: HandleProps & { label: string }) {
  return (
    <button type="button" className="d-drag-handle" aria-label={`Reorder ${label}`} aria-keyshortcuts="ArrowUp ArrowDown" {...props}>
      <Icon name="grip" size={16} />
    </button>
  );
}
