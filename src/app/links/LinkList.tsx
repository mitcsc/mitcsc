"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface LinkItem {
  title: string;
  url: string;
}

const PANDA_SIZE = 48;
const PEEK = 14;
const POLL_INTERVAL = 60_000;

const corners = [
  {
    style: {
      top: -PEEK,
      left: -PEEK,
      bottom: "auto" as const,
      right: "auto" as const,
    },
    hidden: `translate(-${PANDA_SIZE}px, -${PANDA_SIZE}px) rotate(135deg)`,
    visible: `translate(0, 0) rotate(135deg)`,
  },
  {
    style: {
      top: -PEEK,
      right: -PEEK,
      bottom: "auto" as const,
      left: "auto" as const,
    },
    hidden: `translate(${PANDA_SIZE}px, -${PANDA_SIZE}px) rotate(-135deg)`,
    visible: `translate(0, 0) rotate(-135deg)`,
  },
  {
    style: {
      bottom: -PEEK,
      left: -PEEK,
      top: "auto" as const,
      right: "auto" as const,
    },
    hidden: `translate(-${PANDA_SIZE}px, ${PANDA_SIZE}px) rotate(45deg)`,
    visible: `translate(0, 0) rotate(45deg)`,
  },
  {
    style: {
      bottom: -PEEK,
      right: -PEEK,
      top: "auto" as const,
      left: "auto" as const,
    },
    hidden: `translate(${PANDA_SIZE}px, ${PANDA_SIZE}px) rotate(-45deg)`,
    visible: `translate(0, 0) rotate(-45deg)`,
  },
];

export default function LinkList({
  initialLinks,
}: {
  initialLinks: LinkItem[];
}) {
  const [links, setLinks] = useState(initialLinks);
  const [pandaCorners, setPandaCorners] = useState<Record<string, number>>({});
  const [hovered, setHovered] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<Record<string, boolean>>(
    {},
  );
  const rafRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/links");
        if (res.ok) {
          const data = await res.json();
          setLinks(data);
        }
      } catch {
        // silently fail
      }
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  const handleMouseEnter = useCallback((url: string) => {
    const newCorner = Math.floor(Math.random() * corners.length);

    setTransitioning((prev) => ({ ...prev, [url]: true }));
    setPandaCorners((prev) => ({ ...prev, [url]: newCorner }));

    if (rafRef.current[url]) cancelAnimationFrame(rafRef.current[url]);

    rafRef.current[url] = requestAnimationFrame(() => {
      rafRef.current[url] = requestAnimationFrame(() => {
        setTransitioning((prev) => ({ ...prev, [url]: false }));
        setHovered(url);
      });
    });
  }, []);

  return (
    <div className="w-full flex flex-col gap-3">
      {links.length === 0 && (
        <p className="text-secondary font-secondary font-normal text-center text-lg">
          No links available right now.
        </p>
      )}
      {links.map((link) => {
        const corner = corners[pandaCorners[link.url] ?? 0];
        const isHovered = hovered === link.url;
        const isSnapping = transitioning[link.url];
        return (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative w-full py-4 px-6 border border-white/20 rounded-lg text-center font-secondary font-normal text-lg md:text-xl hover:bg-primary hover:border-primary active:bg-primary active:border-primary transition-all duration-300 ease-out overflow-hidden text-balance"
            onMouseEnter={() => handleMouseEnter(link.url)}
            onMouseLeave={() => setHovered(null)}
          >
            <img
              src="/img/logo/panda.png"
              alt=""
              style={{
                position: "absolute",
                width: PANDA_SIZE,
                height: PANDA_SIZE,
                objectFit: "contain",
                pointerEvents: "none",
                ...corner.style,
                transform:
                  isHovered && !isSnapping ? corner.visible : corner.hidden,
                transition: isSnapping
                  ? "none"
                  : isHovered
                    ? "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)"
                    : "transform 0.25s cubic-bezier(0.55, 0, 1, 0.45)",
              }}
            />
            {link.title}
          </a>
        );
      })}
    </div>
  );
}
