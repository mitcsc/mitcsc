"use client";

import { membership } from "@/config/links";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";

export default function Join() {
  const text = "JOIN CHINESE STUDENTS CLUB ";
  const characters = text.split("");
  const [isHovered, setIsHovered] = useState(false);
  const [radius, setRadius] = useState(200); // Start with fallback value

  useEffect(() => {
    // Update radius after component mounts to avoid hydration mismatch
    const updateRadius = () => {
      const newRadius = Math.min(Math.max(window.innerWidth * 0.25, 120), 300);
      setRadius(newRadius);
    };

    updateRadius();
    window.addEventListener("resize", updateRadius);

    return () => window.removeEventListener("resize", updateRadius);
  }, []);

  return (
    <section className="w-full h-screen flex flex-col items-center justify-center overflow-hidden">
      <div className="flex flex-col w-full xl:max-w-[85vw] items-center justify-center">
        <motion.a
          href={membership}
          target="_blank"
          rel="noopener noreferrer"
          className="relative w-96 h-96 flex group items-center justify-center md:w-[500px] md:h-[500px] lg:w-[600px] lg:h-[600px]"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: {
                duration: 0.5,
                delayChildren: 0.2,
                staggerChildren: 0.05,
              },
            },
          }}
          onHoverStart={() => setIsHovered(true)}
          onHoverEnd={() => setIsHovered(false)}
        >
          <motion.img
            src="/img/logo/panda.png"
            alt="Join"
            className={`absolute w-24 h-auto group-hover:scale-150 group-hover:animate-bounce ease-in-out duration-300 aspect-square object-cover`}
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
            }}
            transition={{
              opacity: {
                duration: 0.5,
                delay: 1.6,
              },
            }}
          />
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            animate={{ rotate: -360 }}
            transition={{
              duration: 20,
              repeat: Infinity,
              ease: "linear",
            }}
          >
            <div className="relative w-full h-full">
              {characters.map((char, index) => {
                const angle = (index * 360) / characters.length;
                const x =
                  Math.round(
                    Math.cos((angle - 90) * (Math.PI / 180)) * radius * 100
                  ) / 100;
                const y =
                  Math.round(
                    Math.sin((angle - 90) * (Math.PI / 180)) * radius * 100
                  ) / 100;

                return (
                  <motion.span
                    key={index}
                    className={`absolute text-[7vw] font-primary font-normal transition-colors duration-300 ${
                      isHovered ? "text-primary" : "text-white"
                    }`}
                    style={{
                      left: `calc(50% + ${x}px)`,
                      top: `calc(50% + ${y}px)`,
                      transform: `translate(-50%, -50%) rotate(${Math.round(
                        angle
                      )}deg)`,
                      transformOrigin: "center",
                    }}
                    variants={{
                      hidden: { opacity: 0 },
                      visible: { opacity: 1 },
                    }}
                  >
                    {char}
                  </motion.span>
                );
              })}
            </div>
          </motion.div>
        </motion.a>
      </div>
    </section>
  );
}
