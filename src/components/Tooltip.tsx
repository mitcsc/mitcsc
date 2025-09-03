"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

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
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  return (
    <span
      className={`relative inline-block ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <span className="underline decoration-primary cursor-help">
        {children}
      </span>

      <AnimatePresence>
        {isVisible && (
          <motion.span
            className={`absolute z-50 p-2 text-sm sm:text-base text-white font-secondary font-normal text-center text-balance bg-primary rounded-lg shadow-lg pointer-events-none min-w-[200px] max-w-[320px] w-max block ${
              position === "top"
                ? "bottom-full left-1/2 -translate-x-1/2 mb-1"
                : position === "bottom"
                ? "top-full left-1/2 -translate-x-1/2 mt-1"
                : position === "left"
                ? "right-full top-1/2 -translate-y-1/2 mr-1"
                : "left-full top-1/2 -translate-y-1/2 ml-1"
            }`}
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
            <span
              className={`absolute w-2 h-2 bg-white transform rotate-45 block ${
                position === "top"
                  ? "bottom-[-4px] left-1/2 -translate-x-1/2"
                  : position === "bottom"
                  ? "top-[-4px] left-1/2 -translate-x-1/2"
                  : position === "left"
                  ? "right-[-4px] top-1/2 -translate-y-1/2"
                  : "left-[-4px] top-1/2 -translate-y-1/2"
              }`}
            />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
