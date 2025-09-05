"use client";

import { motion } from "framer-motion";
import PeopleCard from "@/components/PeopleCard";
import { PeopleCardProps } from "@/components/PeopleCard";

interface PeopleGalleryProps {
  directory: string;
  people: Omit<PeopleCardProps, "directory">[];
}

export default function PeopleGallery({
  directory,
  people,
}: PeopleGalleryProps) {
  return (
    <section className="w-full h-auto min-h-screen flex flex-col items-center py-16 overflow-hidden">
      <div className="flex flex-wrap gap-4 w-full xl:max-w-7xl items-center justify-center">
        {people.map((exec, index) => (
          <motion.div
            key={exec.name + index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.3,
              ease: "easeOut",
              delay: index * 0.05,
            }}
          >
            <PeopleCard {...exec} directory={directory} />
          </motion.div>
        ))}
      </div>
    </section>
  );
}
