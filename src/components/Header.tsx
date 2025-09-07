"use client";

import { motion } from "framer-motion";

const springTransition = {
  type: "spring" as const,
  stiffness: 200,
  damping: 30,
  duration: 0.3,
  delay: 0.2,
};

export default function Header({ title }: { title: string }) {
  return (
    <section className="w-full flex flex-col items-center relative pt-24 sm:pt-28 md:pt-40 lg:pt-44 xl:pt-48 text-center">
      <motion.h2
        className="text-[min(30vw,500px)] max-w-7xl leading-[0.8] font-primary font-bold"
        initial={{ opacity: 0, y: 25 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springTransition}
      >
        {title}
      </motion.h2>
    </section>
  );
}
