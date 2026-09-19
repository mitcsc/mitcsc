"use client";

import { useEffect, useRef } from "react";

/** Reveal soft scroll edges only while content remains in that direction. */
export function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      element.dataset.scrollAbove = String(element.scrollTop > 2);
      element.dataset.scrollBelow = String(element.scrollHeight - element.clientHeight - element.scrollTop > 2);
    };
    const resize = new ResizeObserver(update);
    const observeChildren = () => {
      resize.disconnect();
      resize.observe(element);
      for (const child of element.children) resize.observe(child);
      update();
    };
    const mutations = new MutationObserver(observeChildren);
    mutations.observe(element, {childList: true, subtree: true, characterData: true});
    element.addEventListener("scroll", update, {passive: true});
    observeChildren();
    return () => {
      element.removeEventListener("scroll", update);
      mutations.disconnect();
      resize.disconnect();
    };
  }, []);
  return ref;
}
