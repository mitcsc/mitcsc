"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  className?: string;
  delay?: number;
  position?: "top" | "bottom" | "left" | "right";
}

export default function Tooltip({
  children,
  content,
  className = "",
  delay = 200,
  position = "top",
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({
    x: -1000,
    y: -1000,
  });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Callback ref to update position when tooltip element is created
  const setTooltipRef = (node: HTMLDivElement | null) => {
    tooltipRef.current = node;
    if (node && isVisible) {
      // Small delay to ensure the element is fully rendered
      setTimeout(() => {
        updateTooltipPosition();
      }, 0);
    }
  };

  const updateTooltipPosition = () => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();

    let x = 0;
    let y = 0;

    switch (position) {
      case "top":
        x = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
        y = triggerRect.top - tooltipRect.height - 8;
        break;
      case "bottom":
        x = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
        y = triggerRect.bottom + 8;
        break;
      case "left":
        x = triggerRect.left - tooltipRect.width - 8;
        y = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
        break;
      case "right":
        x = triggerRect.right + 8;
        y = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
        break;
    }

    // Keep tooltip within viewport
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (x < 8) x = 8;
    if (x + tooltipRect.width > viewportWidth - 8) {
      x = viewportWidth - tooltipRect.width - 8;
    }
    if (y < 8) y = 8;
    if (y + tooltipRect.height > viewportHeight - 8) {
      y = viewportHeight - tooltipRect.height - 8;
    }

    setTooltipPosition({ x, y });
  };

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  const handleTouchStart = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const handleTouchEnd = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    // Hide tooltip after a delay on touch end
    setTimeout(() => {
      setIsVisible(false);
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Update position when tooltip becomes visible
  useEffect(() => {
    if (isVisible) {
      updateTooltipPosition();
    }
  }, [isVisible, position]);

  return (
    <>
      <span
        ref={triggerRef}
        className={`underline decoration-primary cursor-help ${className}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </span>

      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isVisible && (
              <motion.div
                ref={setTooltipRef}
                className="fixed z-50 p-2 text-base text-white font-secondary font-normal text-center text-balance bg-primary rounded-lg shadow-lg pointer-events-none max-w-xs"
                style={{
                  left: tooltipPosition.x,
                  top: tooltipPosition.y,
                }}
                initial={{
                  opacity: 0,
                  scale: 0.8,
                  y: position === "top" ? 10 : position === "bottom" ? -10 : 0,
                }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{
                  opacity: 0,
                  scale: 0.8,
                  y: position === "top" ? 10 : position === "bottom" ? -10 : 0,
                }}
                transition={{
                  duration: 0.2,
                  ease: [0.25, 0.46, 0.45, 0.94],
                }}
              >
                {content}
                <div
                  className={`absolute w-2 h-2 bg-white transform rotate-45 ${
                    position === "top"
                      ? "bottom-[-4px] left-1/2 -translate-x-1/2"
                      : position === "bottom"
                      ? "top-[-4px] left-1/2 -translate-x-1/2"
                      : position === "left"
                      ? "right-[-4px] top-1/2 -translate-y-1/2"
                      : "left-[-4px] top-1/2 -translate-y-1/2"
                  }`}
                />
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
