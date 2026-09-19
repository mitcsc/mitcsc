"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

const confetti = Array.from({ length: 64 }, (_, i) => ({
  width: `${4 + i % 3}px`,
  height: `${6 + i % 4}px`,
  background: ["#ff4057", "#ffb020", "#ffe34d", "#42dc91", "#38cfff", "#9370ff", "#ff6ac1"][i % 7],
} as CSSProperties));

function ConfettiBurst({ id, onDone }: { id: number; onDone: (id: number) => void }) {
  const particles = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animations = Array.from(particles.current?.children ?? []).map((particle) => {
      if (reducedMotion) return null;
      const vx = (Math.random() - .5) * 620;
      const vy = -180 - Math.random() * 260;
      const duration = 1.6 + Math.random() * .5;
      const spin = (Math.random() - .5) * 1000;
      const phase = Math.random() * Math.PI * 2;
      const frames = Array.from({ length: 31 }, (_, i) => {
        const t = i / 30 * duration;
        const x = vx * (1 - Math.exp(-1.1 * t)) / 1.1 + Math.sin(t * 6 + phase) * t * 9;
        const y = vy * t + 210 * t * t;
        return { transform: `translate3d(${x}px,${y}px,0) rotate(${spin * t}deg) rotateY(${phase * 180 + t * 400}deg)`, opacity: i < 22 ? .9 : .9 * (30 - i) / 8 };
      });
      return particle.animate(frames, { duration: duration * 1000, fill: "both", easing: "linear" });
    });
    const timeout = window.setTimeout(() => onDone(id), 2200);
    return () => { window.clearTimeout(timeout); animations.forEach(animation => animation?.cancel()); };
  }, [id, onDone]);
  return <span ref={particles} className="voter-panda-confetti" aria-hidden="true">{confetti.map((style, i) => <span key={i} style={style}/>)}</span>;
}

export default function WaitingPanda({ jumpOnly = false }: { jumpOnly?: boolean }) {
  const [bursts, setBursts] = useState<number[]>(jumpOnly ? [0] : []);
  const nextBurst = useRef(1);
  const removeBurst = useCallback((id: number) => setBursts(current => current.filter(burst => burst !== id)), []);
  function celebrate() {
    if (!jumpOnly || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = nextBurst.current++;
    // Preserve in-flight bursts; cap simultaneous particles at 256.
    setBursts(current => current.length < 4 ? [...current, id] : current);
  }
  return <span className={`voter-panda-track${jumpOnly ? " voter-panda-jump-only" : ""}`} onClick={jumpOnly ? celebrate : undefined} role={jumpOnly ? "button" : undefined} tabIndex={jumpOnly ? 0 : undefined} aria-label={jumpOnly ? "Celebrate with confetti" : undefined} aria-hidden={jumpOnly ? undefined : true} onKeyDown={event => { if (jumpOnly && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); celebrate(); } }}>
    {bursts.map(id => <ConfettiBurst key={id} id={id} onDone={removeBurst}/>)}
    <span className="voter-panda-hop"><Image draggable={false} className="voter-waiting-panda" src="/img/logo/panda.png" alt="" aria-hidden="true" width={64} height={64}/></span>
  </span>;
}
