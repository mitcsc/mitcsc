"use client";

import { motion } from "framer-motion";
import ExecCard from "@/components/exec/ExecCard";
import { current } from "@/config/exec/current";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.2,
      ease: "easeInOut",
    },
  },
};

export default function Exec() {
  return (
    <section className="w-full h-auto min-h-screen flex flex-col items-center py-16 overflow-hidden">
      <motion.div
        className="flex flex-wrap gap-4 w-full xl:max-w-[85vw] items-center justify-center"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {current.map((exec) => (
          <ExecCard key={exec.name} {...exec} variants={itemVariants} />
        ))}
      </motion.div>
    </section>
  );
}
